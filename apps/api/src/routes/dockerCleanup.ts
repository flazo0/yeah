import { Elysia, t } from "elysia";
import { and, desc, eq } from "drizzle-orm";
import { dockerCleanupExecutions, dockerCleanups, servers, type DockerCleanup, type DockerCleanupExecution } from "@yeah/db";
import type { DockerCleanupExecutionDto, DockerCleanupScheduleDto } from "@yeah/shared";
import { addDockerCleanupSchedule, removeDockerCleanupSchedule } from "@yeah/queue";
import { db } from "../lib/db";
import { getUserFromSessionId, SESSION_COOKIE } from "../lib/session";
import { assertMember } from "../lib/access";
import { dockerCleanupQueue } from "../lib/queue";

// `docker system prune`, scheduled or "run now", one optional schedule per server. Every route
// resolves the server through the team in the URL first, so an id from another team never reaches here.

function toScheduleDto(s: DockerCleanup): DockerCleanupScheduleDto {
  return { id: s.id, serverId: s.serverId, enabled: s.enabled, cron: s.cron, timezone: s.timezone, pruneImages: s.pruneImages, pruneVolumes: s.pruneVolumes, createdAt: s.createdAt.toISOString() };
}

function toExecutionDto(e: DockerCleanupExecution): DockerCleanupExecutionDto {
  return {
    id: e.id,
    serverId: e.serverId,
    status: e.status,
    log: e.log,
    reclaimedBytes: e.reclaimedBytes,
    manual: e.manual,
    startedAt: e.startedAt ? e.startedAt.toISOString() : null,
    finishedAt: e.finishedAt ? e.finishedAt.toISOString() : null,
    createdAt: e.createdAt.toISOString(),
  };
}

export const dockerCleanupRoutes = new Elysia({ prefix: "/teams/:teamId/servers/:serverId/docker-cleanup" })
  .derive(async ({ cookie, params }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) return { dctx: { error: "unauthorized" as const, status: 401 } };
    if (!(await assertMember(params.teamId, user.id))) return { dctx: { error: "forbidden" as const, status: 403 } };
    const [server] = await db.select().from(servers).where(and(eq(servers.id, params.serverId), eq(servers.teamId, params.teamId))).limit(1);
    if (!server) return { dctx: { error: "server not found" as const, status: 404 } };
    return { dctx: { server } };
  })
  .get("/", async ({ dctx, params, set }) => {
    if ("error" in dctx) {
      set.status = dctx.status;
      return { error: dctx.error };
    }
    const [schedule] = await db.select().from(dockerCleanups).where(eq(dockerCleanups.serverId, params.serverId)).limit(1);
    const executions = await db.select().from(dockerCleanupExecutions).where(eq(dockerCleanupExecutions.serverId, params.serverId)).orderBy(desc(dockerCleanupExecutions.createdAt)).limit(20);
    return { schedule: schedule ? toScheduleDto(schedule) : null, executions: executions.map(toExecutionDto) };
  })
  .put(
    "/",
    async ({ dctx, params, body, set }) => {
      if ("error" in dctx) {
        set.status = dctx.status;
        return { error: dctx.error };
      }
      const [existing] = await db.select().from(dockerCleanups).where(eq(dockerCleanups.serverId, params.serverId)).limit(1);
      const next = {
        cron: body.cron ?? existing?.cron ?? "0 4 * * 0",
        timezone: body.timezone ?? existing?.timezone ?? "UTC",
        enabled: body.enabled ?? existing?.enabled ?? false,
        pruneImages: body.pruneImages ?? existing?.pruneImages ?? false,
        pruneVolumes: body.pruneVolumes ?? existing?.pruneVolumes ?? false,
      };
      if (next.enabled) {
        try {
          // upsertJobScheduler re-keys by id: changes cron/timezone in place.
          await addDockerCleanupSchedule(dockerCleanupQueue, params.serverId, next.cron, next.timezone);
        } catch (err) {
          set.status = 400;
          return { error: `agendamento inválido: ${err instanceof Error ? err.message : "cron ou timezone"}` };
        }
      } else {
        await removeDockerCleanupSchedule(dockerCleanupQueue, params.serverId);
      }
      const [schedule] = existing
        ? await db.update(dockerCleanups).set(next).where(eq(dockerCleanups.id, existing.id)).returning()
        : await db.insert(dockerCleanups).values({ serverId: params.serverId, ...next }).returning();
      return { schedule: toScheduleDto(schedule as DockerCleanup) };
    },
    {
      body: t.Object({
        cron: t.Optional(t.String({ minLength: 1 })),
        timezone: t.Optional(t.String()),
        enabled: t.Optional(t.Boolean()),
        pruneImages: t.Optional(t.Boolean()),
        pruneVolumes: t.Optional(t.Boolean()),
      }),
    },
  )
  .post("/run", async ({ dctx, params, set }) => {
    if ("error" in dctx) {
      set.status = dctx.status;
      return { error: dctx.error };
    }
    // Best-effort only (the row is created by the worker once the job actually starts, so a click
    // right after another one can still slip through) — harmless anyway, `docker system prune` on the
    // same host at the same time isn't destructive, just wasted work.
    const [last] = await db.select().from(dockerCleanupExecutions).where(eq(dockerCleanupExecutions.serverId, params.serverId)).orderBy(desc(dockerCleanupExecutions.createdAt)).limit(1);
    if (last && (last.status === "queued" || last.status === "running")) {
      set.status = 409;
      return { error: "já há uma limpeza em andamento neste servidor" };
    }
    await dockerCleanupQueue.add("cleanup", { serverId: params.serverId, manual: true });
    return { queued: true };
  });
