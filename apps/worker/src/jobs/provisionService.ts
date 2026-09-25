import { eq } from "drizzle-orm";
import { services, servers } from "@yeah/db";
import { connectSsh, execStream, writeRemoteFile } from "@yeah/ssh";
import { publishServerEvent, type ServiceProvisionJobData } from "@yeah/queue";
import { composeLifecycleCommand, composeStackOverride, ensureNetworkCommand, environmentNetworkName, internalHostName, parseComposeStack, shellQuote, stackNetworkJoinCommand } from "@yeah/shared";
import type { Job } from "bullmq";
import type Redis from "ioredis";
import { db } from "../lib/db";
import { buildRunCommand, buildStackPullCommand, buildStackUpCommand, containerNameForService, resolveDomain, stackDir, stackProject, STACK_OVERRIDE_FILE } from "./provisionService.commands";

export { buildRunCommand, containerNameForService, resolveDomain } from "./provisionService.commands";

export function makeProvisionServiceProcessor(publishConnection: Redis) {
  return async function provisionService(job: Job<ServiceProvisionJobData>) {
    const { serviceId, action = "deploy" } = job.data;

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

    if (service.composeContent) {
      await provisionStack(service, server, action, publishConnection);
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
      timeoutMs: server.sshTimeoutSeconds * 1000,
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

async function provisionStack(service: typeof services.$inferSelect, server: typeof servers.$inferSelect, action: "deploy" | "start" | "stop" | "restart", publishConnection: Redis) {
  const setStatus = async (status: typeof service.status, lastLog?: string) => {
    await db.update(services).set({ status, ...(lastLog !== undefined ? { lastLog: lastLog.slice(-20000) } : {}) }).where(eq(services.id, service.id));
    await publishServerEvent(publishConnection, { type: "service.status", serviceId: service.id, status });
  };
  let log = "";
  let conn: Awaited<ReturnType<typeof connectSsh>> | null = null;
  try {
    conn = await connectSsh({ host: server.host, port: server.port, username: server.sshUser, privateKey: server.privateKey, timeoutMs: server.sshTimeoutSeconds * 1000 });
    const run = async (command: string, label: string) => {
      log += `$ ${label}\n`;
      let out = "";
      const result = await execStream(conn!, command, (chunk) => {
        out += chunk;
      });
      log += out.endsWith("\n") || out === "" ? out : out + "\n";
      if (result.exitCode !== 0) throw new Error(`"${label}" saiu com código ${result.exitCode}`);
    };

    if (action !== "deploy") {
      await run(composeLifecycleCommand(action, stackProject(service.id), 10), action === "stop" ? "parando os containers" : action === "start" ? "iniciando os containers" : "reiniciando os containers");
      await setStatus(action === "stop" ? "stopped" : "running", log);
      return;
    }

    const parsed = parseComposeStack(service.composeContent!);
    if (!parsed.ok) throw new Error(parsed.error);
    const dir = stackDir(service.id);
    const envNetwork = environmentNetworkName(service.environmentId);
    await run(`mkdir -p ${shellQuote(dir)}`, "preparando o diretório");
    await writeRemoteFile(conn, `${dir}/docker-compose.yml`, service.composeContent!);
    await writeRemoteFile(conn, `${dir}/.env`, service.envContent);
    await writeRemoteFile(
      conn,
      `${dir}/${STACK_OVERRIDE_FILE}`,
      composeStackOverride(parsed.services, { project: stackProject(service.id), domains: service.domains }),
    );
    await run(ensureNetworkCommand(envNetwork), "rede do ambiente");
    await run(buildStackPullCommand(service.id), "baixando as imagens");
    await run(buildStackUpCommand(service.id), "subindo a stack");
    await run(stackNetworkJoinCommand(stackProject(service.id), envNetwork, internalHostName(service.name), service.mainService), "entrando na rede do ambiente");
    await setStatus("running", log + "\nStack no ar.\n");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[worker] service-provision: stack ${service.id} failed:`, message);
    await setStatus("error", log + `\nFalhou: ${message}\n`);
  } finally {
    conn?.end();
  }
}
