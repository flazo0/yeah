import { and, eq, isNull, lt, ne } from "drizzle-orm";
import { applications, containerMetricSamples, databases, serverMetricSamples, servers, services, type Server } from "@yeah/db";
import { connectSsh, execStream } from "@yeah/ssh";
import { allContainerStatsCommand, parseDockerStats } from "@yeah/shared";
import { publishServerEvent, type ServerMetricsJobData } from "@yeah/queue";
import type { Job } from "bullmq";
import type Redis from "ioredis";
import { db } from "../lib/db";
import { notifyTeam } from "../lib/notify";
import { CircuitBreaker } from "../lib/circuitBreaker";
import { crossedThreshold, METRICS_COMMAND, parseMetrics } from "./serverMetrics.commands";

// How long a sample sticks around for the "últimas 24h/7d" charts before the next tick prunes it.
const SAMPLE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export { crossedThreshold, parseMetrics } from "./serverMetrics.commands";

const CPU_THRESHOLD = 90;
const MEM_THRESHOLD = 90;
const DISK_THRESHOLD = 85;

// A dead server is polled every 60s; after 5 straight failures back off (5min, 10min... up to 30min)
// instead of retrying and logging forever.
const breaker = new CircuitBreaker({ threshold: 5, baseCooldownMs: 5 * 60_000, maxCooldownMs: 30 * 60_000 });

export function makeServerMetricsProcessor(publishConnection: Redis) {
  return async function serverMetrics(_job: Job<ServerMetricsJobData>) {
    const allServers = await db.select().from(servers).where(eq(servers.status, "connected"));

    await Promise.all(allServers.map((server) => checkOne(server, publishConnection)));
  };
}

async function checkOne(server: Server, publishConnection: Redis) {
  if (!breaker.shouldAttempt(server.id)) return;
  try {
    const conn = await connectSsh({
      host: server.host,
      port: server.port,
      username: server.sshUser,
      privateKey: server.privateKey,
    timeoutMs: server.sshTimeoutSeconds * 1000,
    });

    let output = "";
    let containerOutput = "";
    try {
      await execStream(conn, METRICS_COMMAND, (chunk) => {
        output += chunk;
      });
      await execStream(conn, allContainerStatsCommand(), (chunk) => {
        containerOutput += chunk;
      });
    } finally {
      conn.end();
    }

    if (breaker.recordSuccess(server.id) === "closed") {
      console.log(`[worker] server-metrics: ${server.name} (${server.id}) reachable again — resuming normal polling`);
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

    await recordHistory(server, metrics, containerOutput);

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
    if (breaker.recordFailure(server.id) === "opened") {
      console.warn(`[worker] server-metrics: ${server.name} (${server.id}) failed 5 times in a row — backing off polling (5min, doubling up to 30min) until it answers`);
    }
  }
}

/**
 * Appends one row of history for the server and for every single-container resource on it (see
 * container_metric_samples in packages/db for the multi-container scope cut), then prunes anything
 * older than 7 days. Best-effort — a failure here must never break the metrics tick itself.
 */
async function recordHistory(server: Server, metrics: { cpu: number; mem: number; disk: number }, containerOutput: string): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - SAMPLE_RETENTION_MS);
    await db.insert(serverMetricSamples).values({ serverId: server.id, cpuPercent: metrics.cpu, memPercent: metrics.mem, diskPercent: metrics.disk });
    await db.delete(serverMetricSamples).where(and(eq(serverMetricSamples.serverId, server.id), lt(serverMetricSamples.capturedAt, cutoff)));

    const stats = parseDockerStats(containerOutput);
    if (stats.length === 0) return;
    const byName = new Map(stats.map((s) => [s.name, s]));

    const [apps, dbs, svcs] = await Promise.all([
      db.select({ id: applications.id }).from(applications).where(and(eq(applications.serverId, server.id), ne(applications.buildPack, "docker_compose"))),
      db.select({ id: databases.id }).from(databases).where(eq(databases.serverId, server.id)),
      db.select({ id: services.id }).from(services).where(and(eq(services.serverId, server.id), isNull(services.composeContent))),
    ]);
    const resources: Array<{ resourceType: "application" | "database" | "service"; resourceId: string; containerName: string }> = [
      ...apps.map((a) => ({ resourceType: "application" as const, resourceId: a.id, containerName: `yeah-app-${a.id}` })),
      ...dbs.map((d) => ({ resourceType: "database" as const, resourceId: d.id, containerName: `yeah-db-${d.id}` })),
      ...svcs.map((s) => ({ resourceType: "service" as const, resourceId: s.id, containerName: `yeah-svc-${s.id}` })),
    ];

    const rows = resources
      .map(({ resourceType, resourceId, containerName }) => {
        const s = byName.get(containerName);
        if (!s) return null;
        return { serverId: server.id, resourceType, resourceId, cpuPercent: s.cpuPercent, memPercent: s.memPercent, memUsedBytes: s.memUsedBytes, netRxBytes: s.netRxBytes, netTxBytes: s.netTxBytes, pids: s.pids };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
    if (rows.length > 0) await db.insert(containerMetricSamples).values(rows);
    await db.delete(containerMetricSamples).where(and(eq(containerMetricSamples.serverId, server.id), lt(containerMetricSamples.capturedAt, cutoff)));
  } catch (err) {
    console.error(`[worker] server-metrics: failed to record history for ${server.id}:`, err instanceof Error ? err.message : err);
  }
}
