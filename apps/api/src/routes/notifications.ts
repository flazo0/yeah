import { Elysia, t } from "elysia";
import { and, eq } from "drizzle-orm";
import { notificationChannels, type NotificationChannel } from "@yeah/db";
import type { NotificationChannelDto } from "@yeah/shared";
import { sendNotification } from "@yeah/notifications";
import { db } from "../lib/db";
import { getUserFromSessionId, SESSION_COOKIE } from "../lib/session";
import { assertMember } from "../lib/access";

function toChannelDto(channel: NotificationChannel): NotificationChannelDto {
  return {
    id: channel.id,
    teamId: channel.teamId,
    name: channel.name,
    type: channel.type,
    url: channel.url,
    telegramChatId: channel.telegramChatId,
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
        type: t.Union([t.Literal("discord"), t.Literal("slack"), t.Literal("telegram"), t.Literal("webhook")]),
        url: t.Optional(t.String()),
        telegramBotToken: t.Optional(t.String()),
        telegramChatId: t.Optional(t.String()),
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

      const [channel] = await db
        .update(notificationChannels)
        .set({ enabled: body.enabled })
        .where(and(eq(notificationChannels.id, params.channelId), eq(notificationChannels.teamId, params.teamId)))
        .returning();
      if (!channel) {
        set.status = 404;
        return { error: "channel not found" };
      }

      return { channel: toChannelDto(channel) };
    },
    { body: t.Object({ enabled: t.Boolean() }) },
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
