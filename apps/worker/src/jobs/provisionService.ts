import { eq } from "drizzle-orm";
import { services, servers } from "@yeah/db";
import { connectSsh, execStream, writeRemoteFile } from "@yeah/ssh";
import { publishServerEvent, type ServiceProvisionJobData } from "@yeah/queue";
import { shellQuote } from "@yeah/shared";
import type { Job } from "bullmq";
import type Redis from "ioredis";
import { db } from "../lib/db";
import { buildRunCommand, containerNameForService, resolveDomain } from "./provisionService.commands";

export { buildRunCommand, containerNameForService, resolveDomain } from "./provisionService.commands";

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
