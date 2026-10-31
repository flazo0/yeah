import { eq } from "drizzle-orm";
import { getPanelDomain, servers } from "@yeah/db";
import { connectSsh, execStream, shellQuote, writeRemoteFile } from "@yeah/ssh";
import { publishServerEvent, type ProxyProvisionJobData } from "@yeah/queue";
import { buildProxyRestartCommand, ERROR_PAGE_DYNAMIC_FILE, ERROR_PAGE_WAKER_FILE, errorPageConfigJson, errorPageDynamicConfig, PANEL_ROUTE_FILE, panelAttachCommand, panelDetachCommand, panelRouteConfig, PROXY_CONTAINER_NAME, PROXY_DIR, PROXY_NETWORK_NAME, traefikStaticConfig } from "@yeah/shared";
import type { Job } from "bullmq";
import type Redis from "ioredis";
import { db } from "../lib/db";
import { notifyTeam } from "../lib/notify";
import { installWaker } from "../lib/appRouting";
import { WAKE_CONFIG_DIR } from "../lib/waker.commands";

export { PROXY_NETWORK_NAME, PROXY_CONTAINER_NAME, PROXY_DIR };

export function makeProvisionProxyProcessor(publishConnection: Redis) {
  return async function provisionProxy(job: Job<ProxyProvisionJobData>) {
    const { serverId, action = "provision" } = job.data;

    const rows = await db.select().from(servers).where(eq(servers.id, serverId)).limit(1);
    const server = rows[0];
    if (!server) {
      console.warn(`[worker] proxy-provision: server ${serverId} not found, skipping`);
      return;
    }

    if (action === "restart") {
      try {
        const conn = await connectSsh({ host: server.host, port: server.port, username: server.sshUser, privateKey: server.privateKey, timeoutMs: server.sshTimeoutSeconds * 1000 });
        try {
          const result = await execStream(conn, buildProxyRestartCommand(), () => {});
          if (result.exitCode !== 0) throw new Error(`the proxy is not active on this server (docker restart exited with code ${result.exitCode})`);
          await db.update(servers).set({ proxyStatus: "active" }).where(eq(servers.id, serverId));
          await publishServerEvent(publishConnection, { type: "server.proxy", serverId, proxyStatus: "active" });
        } finally {
          conn.end();
        }
      } catch (err) {
        console.error(`[worker] proxy-provision: restart failed for ${serverId}:`, err);
        await fail(serverId, publishConnection, err instanceof Error ? err.message : String(err));
      }
      return;
    }

    // The panel's own domain: one file in the proxy's dynamic directory (Traefik watches it, no restart needed).
    if (action === "panel-route") {
      try {
        const domain = await getPanelDomain(db);
        const conn = await connectSsh({ host: server.host, port: server.port, username: server.sshUser, privateKey: server.privateKey, timeoutMs: server.sshTimeoutSeconds * 1000 });
        try {
          const file = `${PROXY_DIR}/dynamic/${PANEL_ROUTE_FILE}`;
          if (domain) {
            await execStream(conn, `mkdir -p ${shellQuote(`${PROXY_DIR}/dynamic`)}`, () => {});
            await writeRemoteFile(conn, file, panelRouteConfig(domain));
            const attached = await execStream(conn, panelAttachCommand(PROXY_NETWORK_NAME, PROXY_DIR), () => {});
            if (attached.exitCode !== 0) throw new Error("the route was written, but the panel's web container could not be connected to the proxy network (is the panel installed in /opt/yeah?)");
          } else {
            await execStream(conn, `rm -f ${shellQuote(file)}`, () => {});
            await execStream(conn, panelDetachCommand(PROXY_NETWORK_NAME), () => {});
          }
        } finally {
          conn.end();
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[worker] proxy-provision: panel route failed for ${serverId}:`, message);
        await notifyTeam(server.teamId, "deploy.failed", `Could not set up the panel domain on ${server.name}`, message, "error");
      }
      return;
    }

    if (!server.acmeEmail) {
      await fail(serverId, publishConnection, "server has no email configured for Let's Encrypt");
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
        const mkdirResult = await execStream(conn, `mkdir -p ${shellQuote(`${PROXY_DIR}/dynamic`)}`, () => {});
        if (mkdirResult.exitCode !== 0) throw new Error(`mkdir -p ${PROXY_DIR}/dynamic exited with code ${mkdirResult.exitCode}`);

        await writeRemoteFile(conn, `${PROXY_DIR}/traefik.yml`, traefikStaticConfig(server.acmeEmail, server.trafficAnalyticsEnabled, server.errorPageEnabled));

        // The optional error page: its router and errors middleware must exist before Traefik starts with the
        // entry-point middleware, and are removed when it is off so an old file never lingers.
        const errorPageFile = `${PROXY_DIR}/dynamic/${ERROR_PAGE_DYNAMIC_FILE}`;
        if (server.errorPageEnabled) await writeRemoteFile(conn, errorPageFile, errorPageDynamicConfig());
        else await execStream(conn, `rm -f ${shellQuote(errorPageFile)}`, () => {});

        // The issued certificates live in acme.json: keep the last three snapshots before touching the proxy, so a
        // bad provision never costs a Let's Encrypt rate-limit window.
        const acme = shellQuote(`${PROXY_DIR}/acme.json`);
        const command =
          `if [ -s ${acme} ]; then cp -p ${acme} ${acme}.bak-$(date +%Y%m%d%H%M%S) && ls -1t ${acme}.bak-* | tail -n +4 | xargs -r rm -f; fi; ` +
          `touch ${shellQuote(`${PROXY_DIR}/acme.json`)} && chmod 600 ${shellQuote(`${PROXY_DIR}/acme.json`)} && ` +
          `docker network create ${shellQuote(PROXY_NETWORK_NAME)} >/dev/null 2>&1 || true && ` +
          // Pull first so re-provisioning picks up the newest patch of the v2.11 line (best-effort: offline hosts keep the local image).
          `docker pull traefik:v2.11 >/dev/null 2>&1 || true && ` +
          `docker rm -f ${shellQuote(PROXY_CONTAINER_NAME)} >/dev/null 2>&1 || true && ` +
          `docker run -d --name ${shellQuote(PROXY_CONTAINER_NAME)} ` +
          `--network ${shellQuote(PROXY_NETWORK_NAME)} ` +
          `-p 80:80 -p 443:443 ` +
          // Loopback-only — never published beyond the host itself, read only via an SSH-run curl
          // (apps/worker/src/jobs/trafficAnalytics.ts), the same "no port stays open to the world
          // that isn't a resource's own domain" rule the rest of the proxy follows.
          (server.trafficAnalyticsEnabled ? `-p 127.0.0.1:8082:8082 ` : "") +
          `-v /var/run/docker.sock:/var/run/docker.sock:ro ` +
          `-v ${shellQuote(`${PROXY_DIR}/traefik.yml`)}:/etc/traefik/traefik.yml:ro ` +
          `-v ${shellQuote(`${PROXY_DIR}/acme.json`)}:/etc/traefik/acme.json ` +
          `-v ${shellQuote(`${PROXY_DIR}/dynamic`)}:/etc/traefik/dynamic ` +
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

        // The waker renders the page; it needs the proxy network, which exists once the proxy ran.
        const wakerErrorConf = `${WAKE_CONFIG_DIR}/${ERROR_PAGE_WAKER_FILE}`;
        if (server.errorPageEnabled) {
          await installWaker(conn);
          await writeRemoteFile(conn, wakerErrorConf, errorPageConfigJson({ title: server.errorPageTitle, message: server.errorPageMessage }));
        } else {
          await execStream(conn, `rm -f ${shellQuote(wakerErrorConf)}`, () => {});
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
