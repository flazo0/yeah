import { eq, isNull } from "drizzle-orm";
import { dockerCleanups, servers } from "@yeah/db";
import { DEFAULT_CLEANUP_CRON, DEFAULT_CLEANUP_TIMEZONE } from "@yeah/shared";
import { addDockerCleanupSchedule, type DockerCleanupJobData } from "@yeah/queue";
import type { Queue } from "bullmq";
import { db } from "./db";

/**
 * Daily cleanup is ON by default: any server that has no cleanup row yet gets an enabled one (04:00 UTC)
 * plus its BullMQ scheduler. A server where someone explicitly turned it off has a row with
 * `enabled = false`, which this never touches. Idempotent — run at boot and once a day.
 */
export async function ensureDefaultCleanups(queue: Queue<DockerCleanupJobData>): Promise<number> {
  const missing = await db
    .select({ id: servers.id })
    .from(servers)
    .leftJoin(dockerCleanups, eq(dockerCleanups.serverId, servers.id))
    .where(isNull(dockerCleanups.id));
  for (const { id } of missing) {
    await db.insert(dockerCleanups).values({ serverId: id, enabled: true, cron: DEFAULT_CLEANUP_CRON, timezone: DEFAULT_CLEANUP_TIMEZONE }).onConflictDoNothing();
    await addDockerCleanupSchedule(queue, id, DEFAULT_CLEANUP_CRON, DEFAULT_CLEANUP_TIMEZONE);
  }
  return missing.length;
}
