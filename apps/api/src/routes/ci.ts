import { Elysia, t } from "elysia";
import { and, eq } from "drizzle-orm";
import { applications, backupSchedules, databases, deployments, servers, services } from "@yeah/db";
import { db } from "../lib/db";
import { resolveApiToken } from "../lib/apiTokenAuth";
import { overloadReason } from "../lib/serverLoad";
import { applicationDeployQueue, databaseBackupQueue } from "../lib/queue";

/**
 * A small, deliberately separate API surface for personal API tokens (Fase 7) — "pensado pra CI/CD"
 * per the roadmap, not a general replacement for the session-cookie API the web app uses. Keeping it
 * separate (rather than retrofitting Bearer-token auth into every existing route) means this is the
 * entire blast radius of a mistake here: a small, newly-written set of read/trigger endpoints, each
 * checking the token itself, instead of a change touching dozens of already-working routes.
 *
 * Every route resolves its own token (no shared session) and takes no project/environment in the URL —
 * a resource is looked up directly by (teamId, id), which `applications`/`databases`/`services` all
 * support since each row already carries its own teamId.
 */
export const ciRoutes = new Elysia({ prefix: "/teams/:teamId/ci" })
  .derive(async ({ headers, params }) => {
    const token = await resolveApiToken(headers.authorization);
    if (!token || token.teamId !== params.teamId) return { ci: { error: "unauthorized" as const, status: 401 } };
    return { ci: { token } };
  })
  .get("/applications", async ({ ci, params, set }) => {
    if ("error" in ci) {
      set.status = ci.status;
      return { error: ci.error };
    }
    const rows = await db
      .select({ id: applications.id, name: applications.name, status: applications.status, domain: applications.domain, serverId: applications.serverId })
      .from(applications)
      .where(eq(applications.teamId, params.teamId));
    return { applications: rows };
  })
  .get("/databases", async ({ ci, params, set }) => {
    if ("error" in ci) {
      set.status = ci.status;
      return { error: ci.error };
    }
    const rows = await db
      .select({ id: databases.id, name: databases.name, engine: databases.engine, status: databases.status })
      .from(databases)
      .where(eq(databases.teamId, params.teamId));
    return { databases: rows };
  })
  .get("/services", async ({ ci, params, set }) => {
    if ("error" in ci) {
      set.status = ci.status;
      return { error: ci.error };
    }
    const rows = await db
      .select({ id: services.id, name: services.name, status: services.status })
      .from(services)
      .where(eq(services.teamId, params.teamId));
    return { services: rows };
  })
  .post(
    "/applications/:applicationId/deploy",
    async ({ ci, params, query, set }) => {
      if ("error" in ci) {
        set.status = ci.status;
        return { error: ci.error };
      }
      if (ci.token.permission !== "full") {
        set.status = 403;
        return { error: "este token é só leitura" };
      }
      const [application] = await db.select().from(applications).where(and(eq(applications.id, params.applicationId), eq(applications.teamId, params.teamId))).limit(1);
      if (!application) {
        set.status = 404;
        return { error: "application not found" };
      }
      const [server] = await db.select().from(servers).where(eq(servers.id, application.serverId)).limit(1);
      const overload = server ? overloadReason(server) : null;
      if (overload && query.force !== "true") {
        set.status = 409;
        return { error: overload, code: "server_overloaded" };
      }
      const [deployment] = await db.insert(deployments).values({ applicationId: application.id, status: "queued" }).returning();
      if (!deployment) {
        set.status = 500;
        return { error: "failed to create deployment" };
      }
      await applicationDeployQueue.add("deploy", { deploymentId: deployment.id });
      return { deploymentId: deployment.id };
    },
    { query: t.Object({ force: t.Optional(t.String()) }) },
  )
  .post("/databases/:databaseId/backup", async ({ ci, params, set }) => {
    if ("error" in ci) {
      set.status = ci.status;
      return { error: ci.error };
    }
    if (ci.token.permission !== "full") {
      set.status = 403;
      return { error: "este token é só leitura" };
    }
    const [database] = await db.select({ id: databases.id }).from(databases).where(and(eq(databases.id, params.databaseId), eq(databases.teamId, params.teamId))).limit(1);
    if (!database) {
      set.status = 404;
      return { error: "database not found" };
    }
    const [schedule] = await db.select().from(backupSchedules).where(eq(backupSchedules.databaseId, database.id)).limit(1);
    if (!schedule) {
      set.status = 404;
      return { error: "este banco não tem um agendamento de backup — crie um pelo painel antes de disparar por aqui" };
    }
    await databaseBackupQueue.add("backup", { scheduleId: schedule.id, manual: true });
    return { queued: true };
  });
