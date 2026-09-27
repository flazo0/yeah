import { Elysia, t } from "elysia";
import { and, eq } from "drizzle-orm";
import { logDrains, type LogDrain } from "@yeah/db";
import type { LogDrainDto } from "@yeah/shared";
import { sendLogs } from "@yeah/logdrains";
import { db } from "../lib/db";
import { getUserFromSessionId, SESSION_COOKIE } from "../lib/session";
import { assertMember } from "../lib/access";

// Log Drains: forward the logs the panel already captures in full at the end of a job (an
// application deploy, a scheduled task run) to Loki, Axiom, New Relic or a Fluent Bit http input.
// Not a continuous tail of container stdout — see docs/ROADMAP.md for that scope boundary.

const KIND_SCHEMA = t.Union([t.Literal("loki"), t.Literal("axiom"), t.Literal("new_relic"), t.Literal("fluent_bit_http")]);

function toDto(drain: LogDrain): LogDrainDto {
  return {
    id: drain.id,
    teamId: drain.teamId,
    name: drain.name,
    kind: drain.kind,
    enabled: drain.enabled,
    url: drain.url,
    lokiUsername: drain.lokiUsername,
    axiomDataset: drain.axiomDataset,
    createdAt: drain.createdAt.toISOString(),
  };
}

export const logDrainRoutes = new Elysia({ prefix: "/teams/:teamId/log-drains" })
  .derive(async ({ cookie, params }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) return { lctx: { error: "unauthorized" as const, status: 401 } };
    if (!(await assertMember(params.teamId, user.id))) return { lctx: { error: "forbidden" as const, status: 403 } };
    return { lctx: {} };
  })
  .get("/", async ({ lctx, params, set }) => {
    if ("error" in lctx) {
      set.status = lctx.status;
      return { error: lctx.error };
    }
    const rows = await db.select().from(logDrains).where(eq(logDrains.teamId, params.teamId));
    return { drains: rows.map(toDto) };
  })
  .post(
    "/",
    async ({ lctx, params, body, set }) => {
      if ("error" in lctx) {
        set.status = lctx.status;
        return { error: lctx.error };
      }
      const [drain] = await db
        .insert(logDrains)
        .values({
          teamId: params.teamId,
          name: body.name,
          kind: body.kind,
          url: body.url ?? null,
          lokiUsername: body.lokiUsername ?? null,
          lokiPassword: body.lokiPassword ?? null,
          axiomDataset: body.axiomDataset ?? null,
          axiomToken: body.axiomToken ?? null,
          newRelicLicenseKey: body.newRelicLicenseKey ?? null,
        })
        .returning();
      if (!drain) {
        set.status = 500;
        return { error: "failed to create log drain" };
      }
      return { drain: toDto(drain) };
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        kind: KIND_SCHEMA,
        url: t.Optional(t.String()),
        lokiUsername: t.Optional(t.String()),
        lokiPassword: t.Optional(t.String()),
        axiomDataset: t.Optional(t.String()),
        axiomToken: t.Optional(t.String()),
        newRelicLicenseKey: t.Optional(t.String()),
      }),
    },
  )
  .put(
    "/:drainId",
    async ({ lctx, params, body, set }) => {
      if ("error" in lctx) {
        set.status = lctx.status;
        return { error: lctx.error };
      }
      const [existing] = await db.select().from(logDrains).where(and(eq(logDrains.id, params.drainId), eq(logDrains.teamId, params.teamId))).limit(1);
      if (!existing) {
        set.status = 404;
        return { error: "log drain not found" };
      }
      const [drain] = await db
        .update(logDrains)
        .set({
          enabled: body.enabled ?? existing.enabled,
          url: body.url ?? existing.url,
          lokiUsername: body.lokiUsername ?? existing.lokiUsername,
          lokiPassword: body.lokiPassword ?? existing.lokiPassword,
          axiomDataset: body.axiomDataset ?? existing.axiomDataset,
          axiomToken: body.axiomToken ?? existing.axiomToken,
          newRelicLicenseKey: body.newRelicLicenseKey ?? existing.newRelicLicenseKey,
        })
        .where(eq(logDrains.id, params.drainId))
        .returning();
      if (!drain) {
        set.status = 500;
        return { error: "failed to update log drain" };
      }
      return { drain: toDto(drain) };
    },
    {
      body: t.Object({
        enabled: t.Optional(t.Boolean()),
        url: t.Optional(t.String()),
        lokiUsername: t.Optional(t.String()),
        lokiPassword: t.Optional(t.String()),
        axiomDataset: t.Optional(t.String()),
        axiomToken: t.Optional(t.String()),
        newRelicLicenseKey: t.Optional(t.String()),
      }),
    },
  )
  .post("/:drainId/test", async ({ lctx, params, set }) => {
    if ("error" in lctx) {
      set.status = lctx.status;
      return { error: lctx.error };
    }
    const [drain] = await db.select().from(logDrains).where(and(eq(logDrains.id, params.drainId), eq(logDrains.teamId, params.teamId))).limit(1);
    if (!drain) {
      set.status = 404;
      return { error: "log drain not found" };
    }
    const ok = await sendLogs(drain, [{ message: `[yeah] teste do drain "${drain.name}" — se isso chegou, está configurado certinho.`, timestamp: new Date(), labels: { source: "yeah", job: "test" } }]);
    return { ok };
  })
  .delete("/:drainId", async ({ lctx, params, set }) => {
    if ("error" in lctx) {
      set.status = lctx.status;
      return { error: lctx.error };
    }
    await db.delete(logDrains).where(and(eq(logDrains.id, params.drainId), eq(logDrains.teamId, params.teamId)));
    return { ok: true };
  });
