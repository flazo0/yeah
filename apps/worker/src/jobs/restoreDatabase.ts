import { eq } from "drizzle-orm";
import { backupExecutions, backupSchedules, databaseRestores, databases, s3Storages, servers } from "@yeah/db";
import { connectSsh, execStream, shellQuote, writeRemoteFile, type Client } from "@yeah/ssh";
import { s3ClientFor } from "@yeah/storage";
import type { DatabaseRestoreJobData } from "@yeah/queue";
import type { Job } from "bullmq";
import { db } from "../lib/db";
import { notifyTeam } from "../lib/notify";
import { buildRestoreSteps } from "./databaseDump.commands";
import { containerNameForDatabase, dbBackupsDir } from "./provisionDatabase.commands";

/**
 * Puts a backup (or an uploaded file) back into its database, replacing what is there. The steps come
 * from buildRestoreSteps; this job only fetches the file, runs them in order and records the log.
 */
export function makeRestoreDatabaseProcessor() {
  return async function restoreDatabase(job: Job<DatabaseRestoreJobData>) {
    const { restoreId, source } = job.data;
    const [restore] = await db.select().from(databaseRestores).where(eq(databaseRestores.id, restoreId)).limit(1);
    if (!restore) return;
    const [database] = await db.select().from(databases).where(eq(databases.id, restore.databaseId)).limit(1);
    const [server] = database ? await db.select().from(servers).where(eq(servers.id, database.serverId)).limit(1) : [];

    let log = "";
    const append = async (text: string) => {
      log += text;
      await db.update(databaseRestores).set({ log }).where(eq(databaseRestores.id, restoreId));
    };
    await db.update(databaseRestores).set({ status: "running", startedAt: new Date() }).where(eq(databaseRestores.id, restoreId));

    if (!database || !server) {
      await db.update(databaseRestores).set({ status: "failed", finishedAt: new Date(), log: "banco ou servidor não existe mais\n" }).where(eq(databaseRestores.id, restoreId));
      return;
    }

    let conn: Client | null = null;
    let tempFile: string | null = null;
    try {
      conn = await connectSsh({ host: server.host, port: server.port, username: server.sshUser, privateKey: server.privateKey, timeoutMs: server.sshTimeoutSeconds * 1000 });
      const run = async (command: string, label: string, allowFailure = false) => {
        await append(`\x1b[36m$ ${label}\x1b[0m\n`);
        let output = "";
        const result = await execStream(conn!, command, (chunk) => {
          output += chunk;
        });
        if (output.trim()) await append(output.endsWith("\n") ? output : output + "\n");
        if (result.exitCode !== 0 && !allowFailure) throw new Error(`"${label}" saiu com código ${result.exitCode}`);
      };

      const dir = dbBackupsDir(database.id);
      await run(`mkdir -p ${shellQuote(dir)}`, "preparando a pasta de backups");

      // 1. the file, on the server
      let filePath: string;
      if (source.kind === "upload") {
        filePath = source.path;
        tempFile = filePath;
      } else {
        const [execution] = await db.select().from(backupExecutions).where(eq(backupExecutions.id, source.executionId)).limit(1);
        if (!execution || !execution.filePath || execution.status !== "success") throw new Error("esse backup não existe ou não terminou com sucesso");
        // The execution must belong to this database (its schedule points at it).
        const [schedule] = await db.select().from(backupSchedules).where(eq(backupSchedules.id, execution.scheduleId)).limit(1);
        if (!schedule || schedule.databaseId !== database.id) throw new Error("esse backup é de outro banco");
        if (execution.s3StorageId) {
          const [storage] = await db.select().from(s3Storages).where(eq(s3Storages.id, execution.s3StorageId)).limit(1);
          if (!storage) throw new Error("o destino S3 desse backup não existe mais");
          await append(`\x1b[36m$ baixando do S3 (${storage.name})\x1b[0m\n`);
          const bytes = await s3ClientFor(storage).file(execution.filePath).arrayBuffer();
          filePath = `${dir}/restore-${Date.now()}-${execution.filePath.split("/").pop()}`;
          await writeRemoteFile(conn, filePath, new Uint8Array(bytes));
          tempFile = filePath;
        } else {
          filePath = execution.filePath;
          await run(`test -f ${shellQuote(filePath)}`, "conferindo o arquivo do backup");
        }
      }

      // 2. the steps
      const steps = buildRestoreSteps(database, containerNameForDatabase(database.id), filePath, `${containerNameForDatabase(database.id)}-data`, dir);
      for (const step of steps) await run(step.command, step.label, step.allowFailure);

      await append("\n\x1b[32mRestore concluído.\x1b[0m\n");
      await db.update(databaseRestores).set({ status: "success", finishedAt: new Date() }).where(eq(databaseRestores.id, restoreId));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await append(`\n\x1b[31mRestore falhou: ${message}\x1b[0m\n`);
      await db.update(databaseRestores).set({ status: "failed", finishedAt: new Date() }).where(eq(databaseRestores.id, restoreId));
      await notifyTeam(database.teamId, "backup.failed", `Restore de ${database.name} falhou`, message, "error");
    } finally {
      if (conn && tempFile) await execStream(conn, `rm -rf ${shellQuote(tempFile)}`, () => undefined).catch(() => undefined);
      conn?.end();
    }
  };
}
