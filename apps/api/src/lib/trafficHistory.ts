import { and, asc, eq, gte } from "drizzle-orm";
import { applicationTrafficSamples } from "@yeah/db";
import { db } from "./db";

export interface TrafficHistoryPoint {
  at: string;
  /** Requests counted since the previous sample, not a cumulative total — see applicationTrafficSamples. */
  requests: number;
}

/**
 * Traefik's counter is cumulative, so each point here is the delta from the sample before it; the
 * very first point in the window is dropped (there's nothing before it inside the window to diff
 * against), same convention Prometheus `rate()` queries use.
 */
export async function loadApplicationTrafficHistory(applicationId: string, hours: number): Promise<TrafficHistoryPoint[]> {
  const clampedHours = Math.min(168, Math.max(1, hours || 24));
  const since = new Date(Date.now() - clampedHours * 60 * 60 * 1000);
  const rows = await db
    .select({ requestCount: applicationTrafficSamples.requestCount, capturedAt: applicationTrafficSamples.capturedAt })
    .from(applicationTrafficSamples)
    .where(and(eq(applicationTrafficSamples.applicationId, applicationId), gte(applicationTrafficSamples.capturedAt, since)))
    .orderBy(asc(applicationTrafficSamples.capturedAt));

  const points: TrafficHistoryPoint[] = [];
  for (let i = 1; i < rows.length; i++) {
    const delta = rows[i]!.requestCount - rows[i - 1]!.requestCount;
    // A negative delta means the counter reset (proxy container recreated) — report 0 rather than a
    // nonsensical negative spike.
    points.push({ at: rows[i]!.capturedAt.toISOString(), requests: Math.max(0, delta) });
  }
  return points;
}
