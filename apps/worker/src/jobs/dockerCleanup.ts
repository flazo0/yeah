import { and, desc, eq, gt } from "drizzle-orm";
import { applications, deployments, dockerCleanupExecutions, dockerCleanups, servers } from "@yeah/db";
import { deploymentImageRef, deploymentsToRetain, dockerImagesCommand, parseDockerImages, selectImagesToRemove } from "@yeah/shared";
import { connectSsh, execStream } from "@yeah/ssh";
import type { DockerCleanupJobData } from "@yeah/queue";
import type { Job } from "bullmq";
import { db } from "../lib/db";
import { notifyTeam } from "../lib/notify";
import { buildHostCleanupCommand, parseReclaimedBytes, type DockerCleanupOptions } from "./dockerCleanup.commands";

export { buildDockerPruneCommand, buildHostCleanupCommand, parseReclaimedBytes } from "./dockerCleanup.commands";

const KEEP_EXECUTIONS = 20;

/** Runs the daily cleanup (docker prune + old build cache + journal/apt) on one server and records the execution — scheduled or "run now". */
export function makeDockerCleanupProcessor() {
  return async function dockerCleanup(job: Job<DockerCleanupJobData>) {
    const { serverId, manual = false } = job.data;
    const [server] = await db.select().from(servers).where(eq(servers.id, serverId)).limit(1);
    if (!server) return;
    const [schedule] = await db.select().from(dockerCleanups).where(eq(dockerCleanups.serverId, serverId)).limit(1);
    // The schedule can be disabled (or gone) between the cron firing and the job running; a manual
    // "run now" always goes through regardless, since the user asked for it right now.
    if (!manual && (!schedule || !schedule.enabled)) return;

    const [execution] = await db.insert(dockerCleanupExecutions).values({ serverId, status: "running", manual, startedAt: new Date() }).returning();
    if (!execution) return;

    try {
      const conn = await connectSsh({ host: server.host, port: server.port, username: server.sshUser, privateKey: server.privateKey, timeoutMs: server.sshTimeoutSeconds * 1000 });
      try {
        const opts: DockerCleanupOptions = { pruneImages: schedule?.pruneImages ?? false, pruneVolumes: schedule?.pruneVolumes ?? false };
        let output = "";
        if (opts.pruneImages) {
          // Applications that keep rollback images: their last N images must survive `prune -a`.
          const protectedRefs = await rollbackImageRefs(serverId);
          if (protectedRefs.size > 0) {
            let listing = "";
            await execStream(conn, dockerImagesCommand(), (chunk, stream) => {
              if (stream === "stdout") listing += chunk;
            });
            opts.removeImageIds = selectImagesToRemove(parseDockerImages(listing), protectedRefs);
          }
        }
        const result = await execStream(conn, buildHostCleanupCommand(opts), (chunk) => {
          output += chunk;
        });
        if (result.exitCode !== 0) throw new Error(`the cleanup exited with code ${result.exitCode}: ${output.trim().slice(-500)}`);
        await db
          .update(dockerCleanupExecutions)
          .set({ status: "success", log: output, reclaimedBytes: parseReclaimedBytes(output), finishedAt: new Date() })
          .where(eq(dockerCleanupExecutions.id, execution.id));
        const freed = parseReclaimedBytes(output);
        await notifyTeam(server.teamId, "docker-cleanup.success", `Cleanup completed on ${server.name}`, freed === null ? "Cleanup completed." : `${(freed / 1024 ** 2).toFixed(0)} MB freed.`, "info");
      } finally {
        conn.end();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db.update(dockerCleanupExecutions).set({ status: "failed", log: message, finishedAt: new Date() }).where(eq(dockerCleanupExecutions.id, execution.id));
      await notifyTeam(server.teamId, "docker-cleanup.failed", `Docker cleanup failed on ${server.name}`, message, "error");
    }
    await applyRetention(serverId);
  };
}

/** The image refs of the last N successful deployments of every application on the server that keeps rollback images. */
async function rollbackImageRefs(serverId: string): Promise<Set<string>> {
  const apps = await db.select({ id: applications.id, keep: applications.rollbackImages }).from(applications).where(and(eq(applications.serverId, serverId), gt(applications.rollbackImages, 0)));
  const refs = new Set<string>();
  for (const app of apps) {
    const rows = await db.select().from(deployments).where(eq(deployments.applicationId, app.id)).orderBy(desc(deployments.createdAt)).limit(200);
    const retained = deploymentsToRetain(rows.map((d) => ({ id: d.id, status: d.status, commitSha: d.commitSha, createdAt: d.createdAt.toISOString() })), app.keep);
    for (const d of retained) refs.add(deploymentImageRef(app.id, d.id));
  }
  return refs;
}

/** Keeps only the newest few executions per server — this is just a maintenance log, not a backup. */
async function applyRetention(serverId: string): Promise<void> {
  const rows = await db.select({ id: dockerCleanupExecutions.id }).from(dockerCleanupExecutions).where(eq(dockerCleanupExecutions.serverId, serverId)).orderBy(desc(dockerCleanupExecutions.createdAt));
  const doomed = rows.slice(KEEP_EXECUTIONS);
  for (const row of doomed) await db.delete(dockerCleanupExecutions).where(eq(dockerCleanupExecutions.id, row.id));
}
