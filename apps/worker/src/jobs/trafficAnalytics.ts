import { and, eq, inArray, lt } from "drizzle-orm";
import { applications, applicationTrafficSamples, servers, type Server } from "@yeah/db";
import { connectSsh, execStream } from "@yeah/ssh";
import type { TrafficAnalyticsJobData } from "@yeah/queue";
import type { Job } from "bullmq";
import { db } from "../lib/db";
import { buildFetchTrafficMetricsCommand, parseTrafficMetrics } from "./trafficAnalytics.commands";

export { buildFetchTrafficMetricsCommand, parseTrafficMetrics } from "./trafficAnalytics.commands";

// Request counts accumulate faster than CPU/mem samples and matter less the older they get, so this
// window is shorter than the 7 days serverMetrics.ts keeps.
const SAMPLE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export function makeTrafficAnalyticsProcessor() {
  return async function trafficAnalytics(_job: Job<TrafficAnalyticsJobData>) {
    const allServers = await db
      .select()
      .from(servers)
      .where(and(eq(servers.status, "connected"), eq(servers.trafficAnalyticsEnabled, true), eq(servers.proxyStatus, "active")));

    await Promise.all(allServers.map((server) => checkOne(server)));
  };
}

async function checkOne(server: Server): Promise<void> {
  try {
    const appRows = await db.select({ id: applications.id }).from(applications).where(eq(applications.serverId, server.id));
    if (appRows.length === 0) return;
    const appIds = new Set(appRows.map((a) => a.id));

    const conn = await connectSsh({ host: server.host, port: server.port, username: server.sshUser, privateKey: server.privateKey, timeoutMs: server.sshTimeoutSeconds * 1000 });
    let output = "";
    try {
      await execStream(conn, buildFetchTrafficMetricsCommand(), (chunk) => {
        output += chunk;
      });
    } finally {
      conn.end();
    }

    const totals = parseTrafficMetrics(output);
    const samples = [...totals.entries()].filter(([applicationId]) => appIds.has(applicationId));
    if (samples.length > 0) {
      await db.insert(applicationTrafficSamples).values(samples.map(([applicationId, requestCount]) => ({ applicationId, requestCount })));
    }

    const cutoff = new Date(Date.now() - SAMPLE_RETENTION_MS);
    await db.delete(applicationTrafficSamples).where(and(inArray(applicationTrafficSamples.applicationId, [...appIds]), lt(applicationTrafficSamples.capturedAt, cutoff)));
  } catch (err) {
    // Best-effort, same as serverMetrics.ts — a server being briefly unreachable (or curl/the metrics
    // port misbehaving) should never fail the whole tick for every other server.
    console.warn(`[worker] traffic-analytics: couldn't read metrics from ${server.name} (${server.id}):`, err instanceof Error ? err.message : err);
  }
}
