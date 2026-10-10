import { Elysia, t } from "elysia";
import { eq } from "drizzle-orm";
import { teams } from "@yeah/db";
import { db } from "../lib/db";
import { getUserFromSessionId, SESSION_COOKIE } from "../lib/session";
import { assertMember } from "../lib/access";
import { resolveApiToken } from "../lib/apiTokenAuth";
import { ipAllowed } from "../lib/ipAllowlist";
import { clientIp } from "../lib/rateLimit";
import { listApplications, listDatabases, listServices, listDeployments, triggerBackup, triggerDeploy } from "../lib/ciActions";
import { handleMcp, type McpOps } from "../lib/mcp";

/**
 * MCP server (Fase 7): JSON-RPC over plain HTTP POST at `/teams/:teamId/mcp`, authenticated with the
 * same personal API tokens as the CI API (a `read` token => read-only mode) and switched on per team
 * from Keys & Tokens. It reuses the CI actions, so it cannot reach anything the CI API cannot — and it
 * never exposes build logs or secrets.
 */
export const mcpRoutes = new Elysia({ prefix: "/teams/:teamId" })
  .post("/mcp", async ({ headers, params, body, request, server, set }) => {
    const token = await resolveApiToken(headers.authorization);
    if (!token || token.teamId !== params.teamId) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    if (!ipAllowed(clientIp(request.headers, server?.requestIP(request)?.address), token.allowedIps)) {
      set.status = 403;
      return { error: "ip não permitido para este token" };
    }
    const [team] = await db.select({ mcpEnabled: teams.mcpEnabled }).from(teams).where(eq(teams.id, params.teamId)).limit(1);
    if (!team?.mcpEnabled) {
      set.status = 403;
      return { error: "o servidor MCP está desligado para este time" };
    }
    const teamId = params.teamId;
    const ops: McpOps = {
      listApplications: () => listApplications(teamId),
      listDatabases: () => listDatabases(teamId),
      listServices: () => listServices(teamId),
      listDeployments: (id) => listDeployments(teamId, id),
      deploy: (id, force) => triggerDeploy(teamId, id, force),
      backup: (id) => triggerBackup(teamId, id),
    };
    const response = await handleMcp(body as Parameters<typeof handleMcp>[0], ops, token.permission !== "full");
    if (response === null) {
      set.status = 202;
      return "";
    }
    return response;
  })
  .get("/mcp-settings", async ({ cookie, params, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    if (!(await assertMember(params.teamId, user.id))) {
      set.status = 403;
      return { error: "forbidden" };
    }
    const [team] = await db.select({ mcpEnabled: teams.mcpEnabled }).from(teams).where(eq(teams.id, params.teamId)).limit(1);
    return { mcpEnabled: team?.mcpEnabled ?? false };
  })
  .put(
    "/mcp-settings",
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
      await db.update(teams).set({ mcpEnabled: body.mcpEnabled }).where(eq(teams.id, params.teamId));
      return { mcpEnabled: body.mcpEnabled };
    },
    { body: t.Object({ mcpEnabled: t.Boolean() }) },
  );
