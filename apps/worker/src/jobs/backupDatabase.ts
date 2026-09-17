import { and, desc, eq } from "drizzle-orm";
import { backupExecutions, backupSchedules, databases, s3Storages, servers, type Database, type S3Storage } from "@yeah/db";
import { connectSsh, execStream, readRemoteFile, removeRemoteFile, shellQuote, type Client } from "@yeah/ssh";
import { publishServerEvent, type DatabaseBackupJobData } from "@yeah/queue";
import { s3ClientFor } from "@yeah/storage";
import type { Job } from "bullmq";
import type Redis from "ioredis";
import { db } from "../lib/db";
import { notifyTeam } from "../lib/notify";
import { containerNameForDatabase } from "./provisionDatabase";

const BACKUP_DIR = (databaseId: string) => `/opt/yeah-backups/${databaseId}`;

function buildDumpCommand(database: Database, containerName: string, filePath: string): string {
  switch (database.engine) {
    case "postgresql":
      return (
        `docker exec ${shellQuote(containerName)} pg_dump -U ${shellQuote(database.username ?? "postgres")} ${shellQuote(database.databaseName ?? "app")} ` +
        `| gzip > ${shellQuote(filePath)}`
      );
    case "mysql":
      return (
        `docker exec -e MYSQL_PWD=${shellQuote(database.password)} ${shellQuote(containerName)} ` +
        `mysqldump -u ${shellQuote(database.username ?? "app")} ${shellQuote(database.databaseName ?? "app")} ` +
        `| gzip > ${shellQuote(filePath)}`
      );
    case "mariadb":
      return (
        `docker exec -e MYSQL_PWD=${shellQuote(database.password)} ${shellQuote(containerName)} ` +
        `mariadb-dump -u ${shellQuote(database.username ?? "app")} ${shellQuote(database.databaseName ?? "app")} ` +
        `| gzip > ${shellQuote(filePath)}`
      );
    case "redis":
      return (
        `docker exec ${shellQuote(containerName)} redis-cli -a ${shellQuote(database.password)} --no-auth-warning --rdb /tmp/dump.rdb >/dev/null && ` +
        `docker exec ${shellQuote(containerName)} cat /tmp/dump.rdb | gzip > ${shellQuote(filePath)}`
      );
    case "mongodb":
      return (
        `docker exec ${shellQuote(containerName)} mongodump --archive --gzip ` +
        `-u ${shellQuote(database.username ?? "root")} -p ${shellQuote(database.password)} --authenticationDatabase admin ` +
        `--db ${shellQuote(database.databaseName ?? "app")} > ${shellQuote(filePath)}`
      );
  }
}

function dumpFileName(database: Database): string {
  const label = database.databaseName ?? database.name;
  const timestamp = Date.now();
  switch (database.engine) {
    case "postgresql":
      return `pg-dump-${label}-${timestamp}.sql.gz`;
    case "mysql":
      return `mysql-dump-${label}-${timestamp}.sql.gz`;
    case "mariadb":
      return `mariadb-dump-${label}-${timestamp}.sql.gz`;
    case "redis":
      return `redis-dump-${label}-${timestamp}.rdb.gz`;
    case "mongodb":
      return `mongo-dump-${label}-${timestamp}.archive.gz`;
  }
}

export function makeBackupDatabaseProcessor(publishConnection: Redis) {
  return async function backupDatabase(job: Job<DatabaseBackupJobData>) {
    const { scheduleId } = job.data;

    const scheduleRows = await db.select().from(backupSchedules).where(eq(backupSchedules.id, scheduleId)).limit(1);
    const schedule = scheduleRows[0];
    if (!schedule || !schedule.enabled) {
      console.warn(`[worker] database-backup: schedule ${scheduleId} missing or disabled, skipping`);
      return;
    }

    const dbRows = await db.select().from(databases).where(eq(databases.id, schedule.databaseId)).limit(1);
    const database = dbRows[0];
    if (!database) return;

    const serverRows = await db.select().from(servers).where(eq(servers.id, database.serverId)).limit(1);
    const server = serverRows[0];
    if (!server) return;

    const [execution] = await db
      .insert(backupExecutions)
      .values({ scheduleId, status: "running", startedAt: new Date() })
      .returning();
    if (!execution) return;

    await publishServerEvent(publishConnection, {
      type: "backup.status",
      executionId: execution.id,
      scheduleId,
      status: "running",
    });

    let log = "";
    const append = (line: string) => {
      log += line;
    };

    let conn: Client | null = null;
    try {
      conn = await connectSsh({
        host: server.host,
        port: server.port,
        username: server.sshUser,
        privateKey: server.privateKey,
      });

      const containerName = containerNameForDatabase(database.id);
      const dir = BACKUP_DIR(database.id);
      const fileName = dumpFileName(database);
      const filePath = `${dir}/${fileName}`;

      const dumpCommand = `mkdir -p ${shellQuote(dir)} && ` + buildDumpCommand(database, containerName, filePath);
      append(`$ backup (${database.engine}) → ${filePath}\n`);
      const dumpResult = await execStream(conn, dumpCommand, (chunk) => append(chunk));
      if (dumpResult.exitCode !== 0) {
        throw new Error(`backup command exited with code ${dumpResult.exitCode}`);
      }

      let sizeOutput = "";
      await execStream(conn, `wc -c < ${shellQuote(filePath)}`, (chunk) => {
        sizeOutput += chunk;
      });
      const sizeBytes = Number.parseInt(sizeOutput.trim(), 10) || 0;

      let finalPath = filePath;
      let s3StorageId: string | null = null;
      if (schedule.storageId) {
        const storageRows = await db.select().from(s3Storages).where(eq(s3Storages.id, schedule.storageId)).limit(1);
        const storage = storageRows[0];
        if (!storage) throw new Error("destino S3 do agendamento não existe mais");

        const objectKey = `${database.id}/${fileName}`;
        append(`$ enviando pra S3 (${storage.name}) → ${objectKey}\n`);
        const buffer = await readRemoteFile(conn, filePath);
        await s3ClientFor(storage).write(objectKey, buffer);
        // The remote copy was only ever a staging area for the upload — S3 is now the record of truth.
        await removeRemoteFile(conn, filePath);

        finalPath = objectKey;
        s3StorageId = storage.id;
      }

      await db
        .update(backupExecutions)
        .set({ status: "success", finishedAt: new Date(), log, filePath: finalPath, s3StorageId, sizeBytes })
        .where(eq(backupExecutions.id, execution.id));

      // Retention must finish before the UI is told to refetch, or it'll catch
      // the list mid-cleanup and briefly show a backup that's about to disappear.
      await applyRetention(conn, schedule, database.id);

      await publishServerEvent(publishConnection, {
        type: "backup.status",
        executionId: execution.id,
        scheduleId,
        status: "success",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      append(`\nfalhou: ${message}\n`);
      await db
        .update(backupExecutions)
        .set({ status: "failed", finishedAt: new Date(), log })
        .where(eq(backupExecutions.id, execution.id));
      await publishServerEvent(publishConnection, {
        type: "backup.status",
        executionId: execution.id,
        scheduleId,
        status: "failed",
      });
      await notifyTeam(database.teamId, "backup.failed", `Backup de ${database.name} falhou`, message, "error");
    } finally {
      conn?.end();
    }
  };
}

async function applyRetention(
  conn: Client,
  schedule: { id: string; retentionCount: number; retentionDays: number; retentionSizeGb: number },
  databaseId: string,
) {
  const successful = await db
    .select()
    .from(backupExecutions)
    .where(and(eq(backupExecutions.scheduleId, schedule.id), eq(backupExecutions.status, "success")))
    .orderBy(desc(backupExecutions.createdAt));

  const toDelete = new Set<string>();

  if (schedule.retentionCount > 0) {
    for (const execution of successful.slice(schedule.retentionCount)) toDelete.add(execution.id);
  }

  if (schedule.retentionDays > 0) {
    const cutoff = Date.now() - schedule.retentionDays * 24 * 60 * 60 * 1000;
    for (const execution of successful) {
      if (execution.createdAt.getTime() < cutoff) toDelete.add(execution.id);
    }
  }

  if (schedule.retentionSizeGb > 0) {
    const limitBytes = schedule.retentionSizeGb * 1024 * 1024 * 1024;
    let cumulative = 0;
    for (const execution of successful) {
      cumulative += execution.sizeBytes ?? 0;
      if (cumulative > limitBytes) toDelete.add(execution.id);
    }
  }

  if (toDelete.size === 0) return;

  const executionsToDelete = successful.filter((execution) => toDelete.has(execution.id));
  const storageCache = new Map<string, S3Storage | null>();
  for (const execution of executionsToDelete) {
    if (execution.filePath && execution.s3StorageId) {
      let storage = storageCache.get(execution.s3StorageId);
      if (storage === undefined) {
        const rows = await db.select().from(s3Storages).where(eq(s3Storages.id, execution.s3StorageId)).limit(1);
        storage = rows[0] ?? null;
        storageCache.set(execution.s3StorageId, storage);
      }
      if (storage) await s3ClientFor(storage).delete(execution.filePath);
    } else if (execution.filePath) {
      await removeRemoteFile(conn, execution.filePath);
    }
    await db.delete(backupExecutions).where(eq(backupExecutions.id, execution.id));
  }
  console.log(`[worker] database-backup: retention removed ${executionsToDelete.length} backup(s) for ${databaseId}`);
}
