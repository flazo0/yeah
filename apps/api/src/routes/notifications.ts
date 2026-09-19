import { Elysia, t } from "elysia";
import { and, eq } from "drizzle-orm";
import { notificationChannels, type NotificationChannel } from "@yeah/db";
import type { NotificationChannelDto, NotificationEventType } from "@yeah/shared";
import { sendNotification } from "@yeah/notifications";
import { db } from "../lib/db";
import { getUserFromSessionId, SESSION_COOKIE } from "../lib/session";
import { assertMember } from "../lib/access";

const EVENT_TYPE_SCHEMA = t.Union([
  t.Literal("deploy.success"),
  t.Literal("deploy.failed"),
  t.Literal("backup.failed"),
  t.Literal("server.down"),
  t.Literal("server.reconnected"),
  t.Literal("server.metrics"),
  t.Literal("tls.expiring"),
]);

function toChannelDto(channel: NotificationChannel): NotificationChannelDto {
  return {
    id: channel.id,
    teamId: channel.teamId,
    name: channel.name,
    type: channel.type,
    url: channel.url,
    telegramChatId: channel.telegramChatId,
    smtpHost: channel.smtpHost,
    smtpPort: channel.smtpPort,
    smtpSecure: channel.smtpSecure,
    smtpUser: channel.smtpUser,
    smtpFrom: channel.smtpFrom,
    emailTo: channel.emailTo,
    events: (channel.events as NotificationEventType[] | null) ?? null,
    enabled: channel.enabled,
    createdAt: channel.createdAt.toISOString(),
  };
}

export const notificationRoutes = new Elysia({ prefix: "/teams/:teamId/notifications" })
  .get("/", async ({ cookie, params, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    if (!(await assertMember(params.teamId, user.id))) {
      set.status = 403;
      return { error: "forbidden" };
    }

    const rows = await db.select().from(notificationChannels).where(eq(notificationChannels.teamId, params.teamId));
    return { channels: rows.map(toChannelDto) };
  })
  .post(
    "/",
    async ({ cookie, params, body, set }) => {
      const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
      if (!user) {
        set.status = 401;
        return { error: "unauthorized" };
      }
      if (!(await assertMember(params.teamId, user.id))) {
        set.status = 403;
        return { error: "forbidden" };
      }

      const [channel] = await db
        .insert(notificationChannels)
        .values({
          teamId: params.teamId,
          name: body.name,
          type: body.type,
          url: body.url ?? null,
          telegramBotToken: body.telegramBotToken ?? null,
          telegramChatId: body.telegramChatId ?? null,
          smtpHost: body.smtpHost ?? null,
          smtpPort: body.smtpPort ?? null,
          smtpSecure: body.smtpSecure ?? null,
          smtpUser: body.smtpUser ?? null,
          smtpPassword: body.smtpPassword ?? null,
          smtpFrom: body.smtpFrom ?? null,
          emailTo: body.emailTo ?? null,
          events: body.events ?? null,
        })
        .returning();
      if (!channel) {
        set.status = 500;
        return { error: "failed to create channel" };
      }

      return { channel: toChannelDto(channel) };
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        type: t.Union([
          t.Literal("discord"),
          t.Literal("slack"),
          t.Literal("telegram"),
          t.Literal("webhook"),
          t.Literal("email"),
        ]),
        url: t.Optional(t.String()),
        telegramBotToken: t.Optional(t.String()),
        telegramChatId: t.Optional(t.String()),
        smtpHost: t.Optional(t.String()),
        smtpPort: t.Optional(t.Number()),
        smtpSecure: t.Optional(t.Boolean()),
        smtpUser: t.Optional(t.String()),
        smtpPassword: t.Optional(t.String()),
        smtpFrom: t.Optional(t.String({ minLength: 1 })),
        emailTo: t.Optional(t.String({ minLength: 1 })),
        events: t.Optional(t.Nullable(t.Array(EVENT_TYPE_SCHEMA))),
      }),
    },
  )
  .put(
    "/:channelId",
    async ({ cookie, params, body, set }) => {
      const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
      if (!user) {
        set.status = 401;
        return { error: "unauthorized" };
      }
      if (!(await assertMember(params.teamId, user.id))) {
        set.status = 403;
        return { error: "forbidden" };
      }

      const existingRows = await db
        .select()
        .from(notificationChannels)
        .where(and(eq(notificationChannels.id, params.channelId), eq(notificationChannels.teamId, params.teamId)))
        .limit(1);
      const existing = existingRows[0];
      if (!existing) {
        set.status = 404;
        return { error: "channel not found" };
      }

      const [channel] = await db
        .update(notificationChannels)
        .set({
          enabled: body.enabled ?? existing.enabled,
          events: "events" in body ? (body.events ?? null) : existing.events,
          smtpHost: body.smtpHost ?? existing.smtpHost,
          smtpPort: body.smtpPort ?? existing.smtpPort,
          smtpSecure: "smtpSecure" in body ? (body.smtpSecure ?? null) : existing.smtpSecure,
          smtpUser: body.smtpUser ?? existing.smtpUser,
          smtpPassword: body.smtpPassword ?? existing.smtpPassword,
          smtpFrom: body.smtpFrom ?? existing.smtpFrom,
          emailTo: body.emailTo ?? existing.emailTo,
        })
        .where(eq(notificationChannels.id, params.channelId))
        .returning();
      if (!channel) {
        set.status = 500;
        return { error: "failed to update channel" };
      }

      return { channel: toChannelDto(channel) };
    },
    {
      body: t.Object({
        enabled: t.Optional(t.Boolean()),
        events: t.Optional(t.Nullable(t.Array(EVENT_TYPE_SCHEMA))),
        smtpHost: t.Optional(t.String()),
        smtpPort: t.Optional(t.Number()),
        smtpSecure: t.Optional(t.Boolean()),
        smtpUser: t.Optional(t.String()),
        smtpPassword: t.Optional(t.String()),
        smtpFrom: t.Optional(t.String({ minLength: 1 })),
        emailTo: t.Optional(t.String({ minLength: 1 })),
      }),
    },
  )
  .post("/:channelId/test", async ({ cookie, params, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    if (!(await assertMember(params.teamId, user.id))) {
      set.status = 403;
      return { error: "forbidden" };
    }

    const rows = await db
      .select()
      .from(notificationChannels)
      .where(and(eq(notificationChannels.id, params.channelId), eq(notificationChannels.teamId, params.teamId)))
      .limit(1);
    const channel = rows[0];
    if (!channel) {
      set.status = 404;
      return { error: "channel not found" };
    }

    const ok = await sendNotification(channel, {
      title: "Teste do yeah",
      body: `Se você recebeu isso, o canal "${channel.name}" está configurado certinho.`,
      level: "info",
    });
    return { ok };
  })
  .delete("/:channelId", async ({ cookie, params, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    if (!(await assertMember(params.teamId, user.id))) {
      set.status = 403;
      return { error: "forbidden" };
    }

    await db
      .delete(notificationChannels)
      .where(and(eq(notificationChannels.id, params.channelId), eq(notificationChannels.teamId, params.teamId)));
    return { ok: true };
  });
