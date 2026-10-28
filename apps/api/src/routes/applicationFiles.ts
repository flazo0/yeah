import { Elysia, t } from "elysia";
import { eq } from "drizzle-orm";
import { servers } from "@yeah/db";
import { connectSsh, execStream } from "@yeah/ssh";
import { isSafeBrowserPath, listDirCommand, looksLikeText, MAX_BROWSER_FILE_BYTES, parseListing, readFileCommand } from "@yeah/shared";
import { requireEnvironmentScope } from "../lib/scope";
import { db } from "../lib/db";
import { getUserFromSessionId, SESSION_COOKIE } from "../lib/session";
import { assertMember } from "../lib/access";
import { loadApplication } from "./applications";

// Read-only file browser for a running application's container (docker exec ls / head over SSH).

async function run(serverId: string, command: string): Promise<{ output: string; exitCode: number } | null> {
  const [server] = await db.select().from(servers).where(eq(servers.id, serverId)).limit(1);
  if (!server) return null;
  const conn = await connectSsh({ host: server.host, port: server.port, username: server.sshUser, privateKey: server.privateKey, timeoutMs: server.sshTimeoutSeconds * 1000 });
  try {
    let output = "";
    const { exitCode } = await execStream(conn, command, (chunk) => {
      output += chunk;
    });
    return { output, exitCode };
  } finally {
    conn.end();
  }
}

export const applicationFilesRoutes = new Elysia({
  prefix: "/teams/:teamId/projects/:projectId/environments/:environmentId/applications",
})
  .onBeforeHandle(requireEnvironmentScope)
  .get(
    "/:applicationId/files",
    async ({ cookie, params, query, set }) => {
      const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
      if (!user) {
        set.status = 401;
        return { error: "unauthorized" };
      }
      if (!(await assertMember(params.teamId, user.id))) {
        set.status = 403;
        return { error: "forbidden" };
      }
      const row = await loadApplication(params.environmentId, params.applicationId);
      if (!row) {
        set.status = 404;
        return { error: "application not found" };
      }
      const path = query.path || "/";
      if (!isSafeBrowserPath(path)) {
        set.status = 400;
        return { error: "caminho inválido" };
      }
      try {
        const result = await run(row.application.serverId, listDirCommand(row.application, path));
        if (!result) {
          set.status = 404;
          return { error: "server not found" };
        }
        if (result.exitCode !== 0) {
          set.status = result.exitCode === 3 ? 409 : 400;
          return { error: result.output.trim().slice(-300) || "não foi possível listar" };
        }
        return { path, entries: parseListing(result.output) };
      } catch (err) {
        set.status = 502;
        return { error: `falha ao falar com o servidor: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
    { query: t.Object({ path: t.Optional(t.String({ maxLength: 1100 })) }) },
  )
  .get(
    "/:applicationId/files/content",
    async ({ cookie, params, query, set }) => {
      const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
      if (!user) {
        set.status = 401;
        return { error: "unauthorized" };
      }
      if (!(await assertMember(params.teamId, user.id))) {
        set.status = 403;
        return { error: "forbidden" };
      }
      const row = await loadApplication(params.environmentId, params.applicationId);
      if (!row) {
        set.status = 404;
        return { error: "application not found" };
      }
      if (!isSafeBrowserPath(query.path)) {
        set.status = 400;
        return { error: "caminho inválido" };
      }
      try {
        const result = await run(row.application.serverId, readFileCommand(row.application, query.path));
        if (!result) {
          set.status = 404;
          return { error: "server not found" };
        }
        if (result.exitCode !== 0) {
          set.status = result.exitCode === 3 ? 409 : 400;
          return { error: result.output.trim().slice(-300) || "não foi possível ler o arquivo" };
        }
        const truncated = result.output.length > MAX_BROWSER_FILE_BYTES;
        const content = truncated ? result.output.slice(0, MAX_BROWSER_FILE_BYTES) : result.output;
        if (!looksLikeText(content)) return { path: query.path, binary: true, content: "", truncated: false };
        return { path: query.path, binary: false, content, truncated };
      } catch (err) {
        set.status = 502;
        return { error: `falha ao falar com o servidor: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
    { query: t.Object({ path: t.String({ maxLength: 1100 }) }) },
  );
