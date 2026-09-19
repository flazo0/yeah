import { eq } from "drizzle-orm";
import { servers, type Server } from "@yeah/db";
import { connectSsh, execStream } from "@yeah/ssh";
import { publishServerEvent, type ServerMetricsJobData } from "@yeah/queue";
import type { Job } from "bullmq";
import type Redis from "ioredis";
import { db } from "../lib/db";
import { notifyTeam } from "../lib/notify";
import { crossedThreshold, METRICS_COMMAND, parseMetrics } from "./serverMetrics.commands";

export { crossedThreshold, parseMetrics } from "./serverMetrics.commands";

const CPU_THRESHOLD = 90;
const MEM_THRESHOLD = 90;
const DISK_THRESHOLD = 85;

export function makeServerMetricsProcessor(publishConnection: Redis) {
  return async function serverMetrics(_job: Job<ServerMetricsJobData>) {
    const allServers = await db.select().from(servers).where(eq(servers.status, "connected"));

    await Promise.all(allServers.map((server) => checkOne(server, publishConnection)));
  };
}

async function checkOne(server: Server, publishConnection: Redis) {
  try {
    const conn = await connectSsh({
      host: server.host,
      port: server.port,
      username: server.sshUser,
      privateKey: server.privateKey,
    });

    let output = "";
    try {
      await execStream(conn, METRICS_COMMAND, (chunk) => {
        output += chunk;
      });
    } finally {
      conn.end();
    }

    const metrics = parseMetrics(output);
    if (!metrics) {
      console.warn(`[worker] server-metrics: couldn't parse output for ${server.id}: ${output.slice(0, 200)}`);
      return;
    }

    await db
      .update(servers)
      .set({
        cpuPercent: metrics.cpu,
        memPercent: metrics.mem,
        diskPercent: metrics.disk,
        metricsCheckedAt: new Date(),
      })
      .where(eq(servers.id, server.id));

    await publishServerEvent(publishConnection, {
      type: "server.metrics",
      serverId: server.id,
      cpuPercent: metrics.cpu,
      memPercent: metrics.mem,
      diskPercent: metrics.disk,
    });

    if (crossedThreshold(server.cpuPercent, metrics.cpu, CPU_THRESHOLD)) {
      await notifyTeam(server.teamId, "server.metrics", `CPU alta em ${server.name}`, `CPU em ${metrics.cpu}% (limiar: ${CPU_THRESHOLD}%).`, "warning");
    }
    if (crossedThreshold(server.memPercent, metrics.mem, MEM_THRESHOLD)) {
      await notifyTeam(server.teamId, "server.metrics", `Memória alta em ${server.name}`, `RAM em ${metrics.mem}% (limiar: ${MEM_THRESHOLD}%) — novos deploys/provisionamentos podem falhar por falta de memória.`, "warning");
    }
    if (crossedThreshold(server.diskPercent, metrics.disk, DISK_THRESHOLD)) {
      await notifyTeam(server.teamId, "server.metrics", `Disco cheio em ${server.name}`, `Disco em ${metrics.disk}% (limiar: ${DISK_THRESHOLD}%) — considere limpar imagens/volumes não usados.`, "error");
    }
  } catch (err) {
    // A single unreachable server shouldn't break the metrics tick for every other server —
    // log and move on. This deliberately doesn't touch `servers.status`, which only reflects
    // the result of an explicit "test connection" — see docs/ARCHITECTURE.md.
    console.error(`[worker] server-metrics: failed to reach ${server.id}:`, err instanceof Error ? err.message : err);
  }
}
