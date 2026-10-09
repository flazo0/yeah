import { eq } from "drizzle-orm";
import { servers } from "@yeah/db";
import { connectSsh, execStream } from "@yeah/ssh";
import type { CloudflareTunnelJobData } from "@yeah/queue";
import type { Job } from "bullmq";
import { db } from "../lib/db";
import { buildInstallCloudflareTunnelCommand, buildRemoveCloudflareTunnelCommand } from "./cloudflareTunnel.commands";

export { buildInstallCloudflareTunnelCommand, buildRemoveCloudflareTunnelCommand, CLOUDFLARE_TUNNEL_CONTAINER_NAME } from "./cloudflareTunnel.commands";

/** Installs or removes the `cloudflared` sidecar that tunnels into this server's own Traefik proxy. */
export function makeCloudflareTunnelProcessor() {
  return async function cloudflareTunnel(job: Job<CloudflareTunnelJobData>) {
    const { serverId, action, token } = job.data;
    const [server] = await db.select().from(servers).where(eq(servers.id, serverId)).limit(1);
    if (!server) return;

    try {
      const conn = await connectSsh({ host: server.host, port: server.port, username: server.sshUser, privateKey: server.privateKey, timeoutMs: server.sshTimeoutSeconds * 1000 });
      try {
        if (action === "install") {
          if (!token) throw new Error("token vazio");
          const result = await execStream(conn, buildInstallCloudflareTunnelCommand(token), () => undefined);
          if (result.exitCode !== 0) throw new Error(`docker run saiu com código ${result.exitCode}`);
          await db.update(servers).set({ cloudflareTunnelStatus: "active", cloudflareTunnelError: null }).where(eq(servers.id, serverId));
        } else {
          const result = await execStream(conn, buildRemoveCloudflareTunnelCommand(), () => undefined);
          if (result.exitCode !== 0) throw new Error(`docker rm saiu com código ${result.exitCode}`);
          await db.update(servers).set({ cloudflareTunnelStatus: "inactive", cloudflareTunnelError: null, cloudflareTunnelToken: null }).where(eq(servers.id, serverId));
        }
      } finally {
        conn.end();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[worker] cloudflare-tunnel: ${action} failed for server ${serverId}:`, message);
      await db.update(servers).set({ cloudflareTunnelStatus: "error", cloudflareTunnelError: message }).where(eq(servers.id, serverId));
    }
  };
}
