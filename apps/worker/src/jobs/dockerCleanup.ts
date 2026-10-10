import { desc, eq } from "drizzle-orm";
import { dockerCleanupExecutions, dockerCleanups, servers } from "@yeah/db";
import { connectSsh, execStream } from "@yeah/ssh";
import type { DockerCleanupJobData } from "@yeah/queue";
import type { Job } from "bullmq";
import { db } from "../lib/db";
import { notifyTeam } from "../lib/notify";
import { buildHostCleanupCommand, parseReclaimedBytes } from "./dockerCleanup.commands";

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
        const opts = { pruneImages: schedule?.pruneImages ?? false, pruneVolumes: schedule?.pruneVolumes ?? false };
        let output = "";
        const result = await execStream(conn, buildHostCleanupCommand(opts), (chunk) => {
          output += chunk;
        });
        if (result.exitCode !== 0) throw new Error(`a limpeza saiu com código ${result.exitCode}: ${output.trim().slice(-500)}`);
        await db
          .update(dockerCleanupExecutions)
          .set({ status: "success", log: output, reclaimedBytes: parseReclaimedBytes(output), finishedAt: new Date() })
          .where(eq(dockerCleanupExecutions.id, execution.id));
        const freed = parseReclaimedBytes(output);
        await notifyTeam(server.teamId, "docker-cleanup.success", `Limpeza concluída em ${server.name}`, freed === null ? "Limpeza concluída." : `${(freed / 1024 ** 2).toFixed(0)} MB liberados.`, "info");
      } finally {
        conn.end();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db.update(dockerCleanupExecutions).set({ status: "failed", log: message, finishedAt: new Date() }).where(eq(dockerCleanupExecutions.id, execution.id));
      await notifyTeam(server.teamId, "docker-cleanup.failed", `Limpeza do Docker falhou em ${server.name}`, message, "error");
    }
    await applyRetention(serverId);
  };
}

/** Keeps only the newest few executions per server — this is just a maintenance log, not a backup. */
async function applyRetention(serverId: string): Promise<void> {
  const rows = await db.select({ id: dockerCleanupExecutions.id }).from(dockerCleanupExecutions).where(eq(dockerCleanupExecutions.serverId, serverId)).orderBy(desc(dockerCleanupExecutions.createdAt));
  const doomed = rows.slice(KEEP_EXECUTIONS);
  for (const row of doomed) await db.delete(dockerCleanupExecutions).where(eq(dockerCleanupExecutions.id, row.id));
}
