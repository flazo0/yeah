import { eq } from "drizzle-orm";
import { services, servers, type Service, type Server } from "@yeah/db";
import { connectSsh, execStream, shellQuote, writeRemoteFile } from "@yeah/ssh";
import { findServiceCatalogEntry, resourceLimitFlags } from "@yeah/shared";
import { publishServerEvent, type ServiceProvisionJobData } from "@yeah/queue";
import type { Job } from "bullmq";
import type Redis from "ioredis";
import { db } from "../lib/db";
import { PROXY_NETWORK_NAME } from "./provisionProxy";

function containerNameForService(serviceId: string): string {
  return `yeah-svc-${serviceId}`;
}

/** null means "publish the port directly on the host" — same rule as applications. */
function resolveDomain(service: Service, server: Server): string | null {
  if (service.domain) return service.domain;
  if (server.proxyStatus !== "active" || !server.wildcardDomain) return null;
  const slug = service.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${slug}.${server.wildcardDomain}`;
}

function buildRunCommand(service: Service, containerName: string, envFilePath: string, domain: string | null): string {
  const catalogEntry = findServiceCatalogEntry(service.catalogKey);
  const volumeFlag = catalogEntry?.volumePath ? `-v ${shellQuote(`${containerName}-data`)}:${shellQuote(catalogEntry.volumePath)} ` : "";
  const base =
    `docker run -d --name ${shellQuote(containerName)} --env-file ${shellQuote(envFilePath)} ${volumeFlag}` +
    resourceLimitFlags(service);
  const restart = `--restart unless-stopped ${shellQuote(service.image)}`;

  if (!domain) {
    return base + `-p ${service.port}:${service.port} ` + restart;
  }

  return (
    base +
    `--network ${shellQuote(PROXY_NETWORK_NAME)} ` +
    `--label traefik.enable=true ` +
    `--label ${shellQuote(`traefik.http.routers.${containerName}.rule=Host(\`${domain}\`)`)} ` +
    `--label traefik.http.routers.${containerName}.entrypoints=websecure ` +
    `--label traefik.http.routers.${containerName}.tls.certresolver=letsencrypt ` +
    `--label traefik.http.services.${containerName}.loadbalancer.server.port=${service.port} ` +
    restart
  );
}

export function makeProvisionServiceProcessor(publishConnection: Redis) {
  return async function provisionService(job: Job<ServiceProvisionJobData>) {
    const { serviceId } = job.data;

    const rows = await db.select().from(services).where(eq(services.id, serviceId)).limit(1);
    const service = rows[0];
    if (!service) {
      console.warn(`[worker] service-provision: service ${serviceId} not found, skipping`);
      return;
    }

    const serverRows = await db.select().from(servers).where(eq(servers.id, service.serverId)).limit(1);
    const server = serverRows[0];
    if (!server) {
      await db.update(services).set({ status: "error" }).where(eq(services.id, serviceId));
      return;
    }

    const containerName = containerNameForService(serviceId);
    const envFileDir = `/opt/yeah-services/${serviceId}`;
    const envFilePath = `${envFileDir}/.env`;
    const domain = resolveDomain(service, server);

    try {
      const conn = await connectSsh({
        host: server.host,
        port: server.port,
        username: server.sshUser,
        privateKey: server.privateKey,
      });

      try {
        const mkdirResult = await execStream(conn, `mkdir -p ${shellQuote(envFileDir)}`, () => {});
        if (mkdirResult.exitCode !== 0) throw new Error(`mkdir -p ${envFileDir} exited with code ${mkdirResult.exitCode}`);

        await writeRemoteFile(conn, envFilePath, service.envContent);

        const command =
          `docker rm -f ${shellQuote(containerName)} >/dev/null 2>&1 || true && ` +
          buildRunCommand(service, containerName, envFilePath, domain);

        let output = "";
        const result = await execStream(conn, command, (chunk) => {
          output += chunk;
        });
        if (result.exitCode !== 0) {
          throw new Error(`docker run exited with code ${result.exitCode}: ${output.trim()}`);
        }

        await db.update(services).set({ status: "running" }).where(eq(services.id, serviceId));
        await publishServerEvent(publishConnection, { type: "service.status", serviceId, status: "running" });
      } finally {
        conn.end();
      }
    } catch (err) {
      console.error(`[worker] service-provision: failed for ${serviceId}:`, err);
      await db.update(services).set({ status: "error" }).where(eq(services.id, serviceId));
      await publishServerEvent(publishConnection, { type: "service.status", serviceId, status: "error" });
    }
  };
}
