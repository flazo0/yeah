import { eq } from "drizzle-orm";
import { servers } from "@yeah/db";
import { connectSsh, execStream, shellQuote, writeRemoteFile } from "@yeah/ssh";
import { publishServerEvent, type ProxyProvisionJobData } from "@yeah/queue";
import { PROXY_NETWORK_NAME } from "@yeah/shared";
import type { Job } from "bullmq";
import type Redis from "ioredis";
import { db } from "../lib/db";

export { PROXY_NETWORK_NAME };
export const PROXY_CONTAINER_NAME = "yeah-proxy";
const PROXY_DIR = "/opt/yeah-proxy";

function traefikStaticConfig(acmeEmail: string): string {
  return `entryPoints:
  web:
    address: ":80"
    http:
      redirections:
        entryPoint:
          to: websecure
          scheme: https
  websecure:
    address: ":443"

providers:
  docker:
    exposedByDefault: false
    network: ${PROXY_NETWORK_NAME}

certificatesResolvers:
  letsencrypt:
    acme:
      email: ${acmeEmail}
      storage: /etc/traefik/acme.json
      httpChallenge:
        entryPoint: web
`;
}

export function makeProvisionProxyProcessor(publishConnection: Redis) {
  return async function provisionProxy(job: Job<ProxyProvisionJobData>) {
    const { serverId } = job.data;

    const rows = await db.select().from(servers).where(eq(servers.id, serverId)).limit(1);
    const server = rows[0];
    if (!server) {
      console.warn(`[worker] proxy-provision: server ${serverId} not found, skipping`);
      return;
    }
    if (!server.acmeEmail) {
      await fail(serverId, publishConnection, "servidor sem e-mail configurado pro Let's Encrypt");
      return;
    }

    try {
      const conn = await connectSsh({
        host: server.host,
        port: server.port,
        username: server.sshUser,
        privateKey: server.privateKey,
      timeoutMs: server.sshTimeoutSeconds * 1000,
      });

      try {
        const mkdirResult = await execStream(conn, `mkdir -p ${shellQuote(PROXY_DIR)}`, () => {});
        if (mkdirResult.exitCode !== 0) throw new Error(`mkdir -p ${PROXY_DIR} exited with code ${mkdirResult.exitCode}`);

        await writeRemoteFile(conn, `${PROXY_DIR}/traefik.yml`, traefikStaticConfig(server.acmeEmail));

        const command =
          `touch ${shellQuote(`${PROXY_DIR}/acme.json`)} && chmod 600 ${shellQuote(`${PROXY_DIR}/acme.json`)} && ` +
          `docker network create ${shellQuote(PROXY_NETWORK_NAME)} >/dev/null 2>&1 || true && ` +
          `docker rm -f ${shellQuote(PROXY_CONTAINER_NAME)} >/dev/null 2>&1 || true && ` +
          `docker run -d --name ${shellQuote(PROXY_CONTAINER_NAME)} ` +
          `--network ${shellQuote(PROXY_NETWORK_NAME)} ` +
          `-p 80:80 -p 443:443 ` +
          `-v /var/run/docker.sock:/var/run/docker.sock:ro ` +
          `-v ${shellQuote(`${PROXY_DIR}/traefik.yml`)}:/etc/traefik/traefik.yml:ro ` +
          `-v ${shellQuote(`${PROXY_DIR}/acme.json`)}:/etc/traefik/acme.json ` +
          // Pinned to v2 — v3.5's bundled Docker client sends a version-negotiation request that a
          // very new/prerelease Docker Engine (observed: API 1.55) answers with an opaque 400,
          // which breaks container discovery entirely. v2's older client doesn't hit this.
          `--restart unless-stopped traefik:v2.11`;

        let output = "";
        const result = await execStream(conn, command, (chunk) => {
          output += chunk;
        });
        if (result.exitCode !== 0) {
          throw new Error(`docker run exited with code ${result.exitCode}: ${output.trim()}`);
        }

        await db.update(servers).set({ proxyStatus: "active" }).where(eq(servers.id, serverId));
        await publishServerEvent(publishConnection, { type: "server.proxy", serverId, proxyStatus: "active" });
      } finally {
        conn.end();
      }
    } catch (err) {
      console.error(`[worker] proxy-provision: failed for ${serverId}:`, err);
      await fail(serverId, publishConnection, err instanceof Error ? err.message : String(err));
    }
  };
}

async function fail(serverId: string, publishConnection: Redis, message: string) {
  console.error(`[worker] proxy-provision: ${serverId} — ${message}`);
  await db.update(servers).set({ proxyStatus: "error" }).where(eq(servers.id, serverId));
  await publishServerEvent(publishConnection, { type: "server.proxy", serverId, proxyStatus: "error" });
}
