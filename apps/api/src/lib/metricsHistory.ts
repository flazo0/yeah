import { and, eq, gte } from "drizzle-orm";
import { containerMetricSamples } from "@yeah/db";
import { db } from "./db";

export interface MetricHistoryPoint {
  at: string;
  cpu: number;
  mem: number;
  memUsedBytes: number;
}

/**
 * A single-container resource's CPU/mem history (an application not on docker_compose, a database, a
 * legacy single-container service) — see container_metric_samples in packages/db for why multi-container
 * resources aren't covered. Capped at 7 days, same as the retention the capture job prunes to.
 */
export async function loadResourceMetricHistory(resourceType: "application" | "database" | "service", resourceId: string, hours: number): Promise<MetricHistoryPoint[]> {
  const clampedHours = Math.min(168, Math.max(1, hours || 24));
  const since = new Date(Date.now() - clampedHours * 60 * 60 * 1000);
  const rows = await db
    .select({ cpuPercent: containerMetricSamples.cpuPercent, memPercent: containerMetricSamples.memPercent, memUsedBytes: containerMetricSamples.memUsedBytes, capturedAt: containerMetricSamples.capturedAt })
    .from(containerMetricSamples)
    .where(and(eq(containerMetricSamples.resourceType, resourceType), eq(containerMetricSamples.resourceId, resourceId), gte(containerMetricSamples.capturedAt, since)))
    .orderBy(containerMetricSamples.capturedAt);
  return rows.map((r) => ({ at: r.capturedAt.toISOString(), cpu: r.cpuPercent, mem: r.memPercent, memUsedBytes: r.memUsedBytes }));
}
