import { Elysia, t } from "elysia";
import { resolveApiToken } from "../lib/apiTokenAuth";
import { ipAllowed } from "../lib/ipAllowlist";
import { clientIp } from "../lib/rateLimit";
import { listDeployments, listNotificationChannels, listProjects, listScheduledTasks, listServers, listStorages, moveResource, listApplications, listDatabases, listServices, triggerBackup, triggerDeploy } from "../lib/ciActions";

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
const makeCiRoutes = (prefix: string) =>
  new Elysia({ prefix: prefix as "/teams/:teamId/ci" }) // cast keeps the :teamId param typing; the runtime prefix differs for v1
  .derive(async ({ headers, params, request, server }) => {
    const token = await resolveApiToken(headers.authorization);
    if (!token || token.teamId !== params.teamId) return { ci: { error: "unauthorized" as const, status: 401 } };
    if (!ipAllowed(clientIp(request.headers, server?.requestIP(request)?.address), token.allowedIps)) return { ci: { error: "ip não permitido para este token" as const, status: 403 } };
    return { ci: { token } };
  })
  .get("/applications", async ({ ci, params, set }) => {
    if ("error" in ci) {
      set.status = ci.status;
      return { error: ci.error };
    }
    return { applications: await listApplications(params.teamId) };
  })
  .get("/databases", async ({ ci, params, set }) => {
    if ("error" in ci) {
      set.status = ci.status;
      return { error: ci.error };
    }
    return { databases: await listDatabases(params.teamId) };
  })
  .get("/services", async ({ ci, params, set }) => {
    if ("error" in ci) {
      set.status = ci.status;
      return { error: ci.error };
    }
    return { services: await listServices(params.teamId) };
  })
  .get("/servers", async ({ ci, params, set }) => {
    if ("error" in ci) {
      set.status = ci.status;
      return { error: ci.error };
    }
    return { servers: await listServers(params.teamId) };
  })
  .get("/projects", async ({ ci, params, set }) => {
    if ("error" in ci) {
      set.status = ci.status;
      return { error: ci.error };
    }
    return { projects: await listProjects(params.teamId) };
  })
  .get("/storages", async ({ ci, params, set }) => {
    if ("error" in ci) {
      set.status = ci.status;
      return { error: ci.error };
    }
    return { storages: await listStorages(params.teamId) };
  })
  .get("/notification-channels", async ({ ci, params, set }) => {
    if ("error" in ci) {
      set.status = ci.status;
      return { error: ci.error };
    }
    return { notificationChannels: await listNotificationChannels(params.teamId) };
  })
  .get("/scheduled-tasks", async ({ ci, params, set }) => {
    if ("error" in ci) {
      set.status = ci.status;
      return { error: ci.error };
    }
    return { scheduledTasks: await listScheduledTasks(params.teamId) };
  })
  .get("/applications/:applicationId/deployments", async ({ ci, params, set }) => {
    if ("error" in ci) {
      set.status = ci.status;
      return { error: ci.error };
    }
    const result = await listDeployments(params.teamId, params.applicationId);
    if (!result.ok) {
      set.status = result.status;
      return { error: result.error };
    }
    return { deployments: result.value };
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
      const result = await triggerDeploy(params.teamId, params.applicationId, query.force === "true");
      if (!result.ok) {
        set.status = result.status;
        return { error: result.error, code: result.code };
      }
      return result.value;
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
    const result = await triggerBackup(params.teamId, params.databaseId);
    if (!result.ok) {
      set.status = result.status;
      return { error: result.error };
    }
    return result.value;
  })
  .post(
    "/move-resource",
    async ({ ci, params, body, set }) => {
      if ("error" in ci) {
        set.status = ci.status;
        return { error: ci.error };
      }
      if (ci.token.permission !== "full") {
        set.status = 403;
        return { error: "este token é só leitura" };
      }
      const result = await moveResource(params.teamId, body.kind, body.resourceId, body.targetEnvironmentId);
      if (!result.ok) {
        set.status = result.status;
        return { error: result.error };
      }
      return result.value;
    },
    {
      body: t.Object({
        kind: t.Union([t.Literal("application"), t.Literal("database"), t.Literal("service")]),
        resourceId: t.String(),
        targetEnvironmentId: t.String(),
      }),
    },
  );

/** Original path, kept so existing scripts/CLI keep working. */
export const ciRoutes = makeCiRoutes("/teams/:teamId/ci");
/** Versioned alias: same handlers under `/api/v1/teams/:teamId/...` (documented in the OpenAPI spec). */
export const apiV1Routes = makeCiRoutes("/api/v1/teams/:teamId");
