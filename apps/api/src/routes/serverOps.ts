import { Elysia, t } from "elysia";
import { and, eq } from "drizzle-orm";
import { servers, type Server } from "@yeah/db";
import { connectSsh, execStream, shellQuote } from "@yeah/ssh";
import {
  applyPatchesCommand,
  autoSecurityUpdatesCommand,
  autoSecurityUpdatesStatusCommand,
  dockerImageRemoveCommand,
  dockerImagesCommand,
  isSafeImageRef,
  parseDockerImages,
  parsePatchCheck,
  patchCheckCommand,
} from "@yeah/shared";
import { db } from "../lib/db";
import { getUserFromSessionId, SESSION_COOKIE } from "../lib/session";
import { assertMember } from "../lib/access";

// Host maintenance on one managed server: Docker images and operating-system updates (apt). Short SSH
// round-trips made on demand; the periodic patch check lives in the worker.

/** apt needs root: non-root users go through passwordless sudo. */
function asRoot(server: Server, command: string): string {
  return server.sshUser === "root" ? command : `sudo -n sh -c ${shellQuote(command)}`;
}

async function runOnServer(server: Server, command: string): Promise<{ output: string; exitCode: number }> {
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

function patchView(server: Server) {
  return {
    updates: server.patchUpdates,
    security: server.patchSecurity,
    rebootRequired: server.patchRebootRequired,
    checkedAt: server.patchCheckedAt ? server.patchCheckedAt.toISOString() : null,
    autoSecurityUpdates: server.autoSecurityUpdates,
    packages: server.patchPackages ?? [],
  };
}

export const serverOpsRoutes = new Elysia({ prefix: "/teams/:teamId/servers/:serverId" })
  .derive(async ({ cookie, params }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) return { sctx: { error: "unauthorized" as const, status: 401 } };
    if (!(await assertMember(params.teamId, user.id))) return { sctx: { error: "forbidden" as const, status: 403 } };
    const [server] = await db.select().from(servers).where(and(eq(servers.id, params.serverId), eq(servers.teamId, params.teamId))).limit(1);
    if (!server) return { sctx: { error: "server not found" as const, status: 404 } };
    return { sctx: { server } };
  })
  .get("/docker-images", async ({ sctx, set }) => {
    if ("error" in sctx) {
      set.status = sctx.status;
      return { error: sctx.error };
    }
    try {
      const { output, exitCode } = await runOnServer(sctx.server, dockerImagesCommand());
      if (exitCode !== 0 && !output.includes("IMG|")) {
        set.status = 502;
        return { error: `não foi possível listar as imagens: ${output.trim().slice(-300)}` };
      }
      return { images: parseDockerImages(output) };
    } catch (err) {
      set.status = 502;
      return { error: `falha ao falar com o servidor: ${err instanceof Error ? err.message : String(err)}` };
    }
  })
  .post(
    "/docker-images/remove",
    async ({ sctx, body, set }) => {
      if ("error" in sctx) {
        set.status = sctx.status;
        return { error: sctx.error };
      }
      if (!isSafeImageRef(body.ref)) {
        set.status = 400;
        return { error: "referência de imagem inválida" };
      }
      try {
        const { output, exitCode } = await runOnServer(sctx.server, dockerImageRemoveCommand(body.ref));
        if (exitCode !== 0) {
          set.status = 409;
          return { error: output.trim().slice(-300) || "o Docker recusou apagar a imagem (ela está em uso?)" };
        }
        return { removed: true };
      } catch (err) {
        set.status = 502;
        return { error: `falha ao falar com o servidor: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
    { body: t.Object({ ref: t.String({ minLength: 1, maxLength: 255 }) }) },
  )
  .get("/patches", ({ sctx, set }) => {
    if ("error" in sctx) {
      set.status = sctx.status;
      return { error: sctx.error };
    }
    return { patches: patchView(sctx.server) };
  })
  .post("/patches/check", async ({ sctx, set }) => {
    if ("error" in sctx) {
      set.status = sctx.status;
      return { error: sctx.error };
    }
    try {
      const { output } = await runOnServer(sctx.server, asRoot(sctx.server, patchCheckCommand()));
      const status = parsePatchCheck(output);
      const [updated] = await db
        .update(servers)
        .set({ patchCheckedAt: new Date(), patchUpdates: status.updates, patchSecurity: status.security, patchRebootRequired: status.rebootRequired, patchPackages: status.packages })
        .where(eq(servers.id, sctx.server.id))
        .returning();
      return { patches: patchView(updated ?? sctx.server) };
    } catch (err) {
      set.status = 502;
      return { error: `falha ao falar com o servidor: ${err instanceof Error ? err.message : String(err)}` };
    }
  })
  .post(
    "/patches/apply",
    async ({ sctx, body, set }) => {
      if ("error" in sctx) {
        set.status = sctx.status;
        return { error: sctx.error };
      }
      try {
        const { output, exitCode } = await runOnServer(sctx.server, asRoot(sctx.server, applyPatchesCommand(body.securityOnly === true)));
        if (exitCode !== 0) {
          set.status = 502;
          return { error: output.trim().slice(-300) || "não foi possível iniciar a atualização" };
        }
        // Runs detached on the server (can take minutes); a new check afterwards shows the result.
        return { started: true };
      } catch (err) {
        set.status = 502;
        return { error: `falha ao falar com o servidor: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
    { body: t.Object({ securityOnly: t.Optional(t.Boolean()) }) },
  )
  .put(
    "/patches/auto",
    async ({ sctx, body, set }) => {
      if ("error" in sctx) {
        set.status = sctx.status;
        return { error: sctx.error };
      }
      try {
        const { output, exitCode } = await runOnServer(sctx.server, asRoot(sctx.server, autoSecurityUpdatesCommand(body.enabled)));
        if (exitCode !== 0 || !output.includes("ok")) {
          set.status = 502;
          return { error: output.trim().slice(-300) || "não foi possível alterar as atualizações automáticas" };
        }
        const check = await runOnServer(sctx.server, autoSecurityUpdatesStatusCommand());
        const actual = check.output.trim() === "on";
        const [updated] = await db.update(servers).set({ autoSecurityUpdates: actual }).where(eq(servers.id, sctx.server.id)).returning();
        return { patches: patchView(updated ?? sctx.server) };
      } catch (err) {
        set.status = 502;
        return { error: `falha ao falar com o servidor: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
    { body: t.Object({ enabled: t.Boolean() }) },
  );
