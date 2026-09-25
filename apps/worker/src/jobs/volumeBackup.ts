import { and, desc, eq } from "drizzle-orm";
import { applicationVolumes, applications, servers, volumeBackups } from "@yeah/db";
import { connectSsh, execStream, shellQuote, type Client } from "@yeah/ssh";
import type { VolumeBackupJobData } from "@yeah/queue";
import type { Job } from "bullmq";
import { db } from "../lib/db";
import { notifyTeam } from "../lib/notify";
import {
  buildVolumeBackupCommand,
  buildVolumeRestoreCommands,
  KEEP_VOLUME_BACKUPS,
  volumeArchiveName,
  volumeBackupsDir,
  type VolumeSource,
} from "./volumeBackup.commands";

/** Runs one volume_backups row: an archive of a volume, or the restore of an earlier archive. */
export function makeVolumeBackupProcessor() {
  return async function volumeBackup(job: Job<VolumeBackupJobData>) {
    const [row] = await db.select().from(volumeBackups).where(eq(volumeBackups.id, job.data.backupId)).limit(1);
    if (!row || row.ownerType !== "application") return;
    const [application] = await db.select().from(applications).where(eq(applications.id, row.ownerId)).limit(1);
    const [server] = application ? await db.select().from(servers).where(eq(servers.id, application.serverId)).limit(1) : [];

    let log = "";
    const append = async (text: string) => {
      log += text;
      await db.update(volumeBackups).set({ log }).where(eq(volumeBackups.id, row.id));
    };
    await db.update(volumeBackups).set({ status: "running", startedAt: new Date() }).where(eq(volumeBackups.id, row.id));

    let conn: Client | null = null;
    try {
      if (!application || !server) throw new Error("aplicação ou servidor não existe mais");
      // A restore names its source archive; a backup names the volume directly.
      const isRestore = row.operation === "restore";
      let sourceRow = row;
      if (isRestore) {
        const [src] = row.sourceBackupId ? await db.select().from(volumeBackups).where(eq(volumeBackups.id, row.sourceBackupId)).limit(1) : [];
        if (!src || src.ownerId !== row.ownerId || !src.filePath) throw new Error("o backup de origem não existe mais");
        sourceRow = src;
      }
      const [volume] = sourceRow.volumeId ? await db.select().from(applicationVolumes).where(and(eq(applicationVolumes.id, sourceRow.volumeId), eq(applicationVolumes.applicationId, application.id))).limit(1) : [];
      if (!volume) throw new Error("o volume não existe mais (foi removido da aplicação)");
      const source: VolumeSource = { kind: volume.kind, id: volume.id, hostPath: volume.hostPath, applicationId: application.id };

      conn = await connectSsh({ host: server.host, port: server.port, username: server.sshUser, privateKey: server.privateKey, timeoutMs: server.sshTimeoutSeconds * 1000 });
      const run = async (command: string, label: string) => {
        await append(`\x1b[36m$ ${label}\x1b[0m\n`);
        let output = "";
        const result = await execStream(conn!, command, (chunk) => {
          output += chunk;
        });
        if (output.trim()) await append(output.endsWith("\n") ? output : output + "\n");
        if (result.exitCode !== 0) throw new Error(`"${label}" saiu com código ${result.exitCode}`);
      };
      const containerName = `yeah-app-${application.id}`;

      if (!isRestore) {
        const dir = volumeBackupsDir(application.id);
        const archive = `${dir}/${volumeArchiveName(volume.id)}`;
        await run(`mkdir -p ${shellQuote(dir)}`, "preparando a pasta");
        await run(buildVolumeBackupCommand(source, archive), `arquivando ${volume.mountPath}`);
        let size = "";
        await execStream(conn, `wc -c < ${shellQuote(archive)}`, (c) => (size += c));
        await db.update(volumeBackups).set({ status: "success", finishedAt: new Date(), filePath: archive, sizeBytes: Number.parseInt(size.trim(), 10) || 0 }).where(eq(volumeBackups.id, row.id));
        await append("\n\x1b[32mBackup concluído.\x1b[0m\n");
        await applyRetention(conn, application.id, volume.id);
      } else {
        const commands = buildVolumeRestoreCommands(source, sourceRow.filePath!, containerName);
        await run(commands.stop, "parando a aplicação");
        try {
          await run(commands.replace, `restaurando ${volume.mountPath}`);
        } finally {
          await run(commands.start, "iniciando a aplicação");
        }
        await db.update(volumeBackups).set({ status: "success", finishedAt: new Date(), filePath: sourceRow.filePath }).where(eq(volumeBackups.id, row.id));
        await append("\n\x1b[32mRestore concluído.\x1b[0m\n");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await append(`\n\x1b[31mFalhou: ${message}\x1b[0m\n`);
      await db.update(volumeBackups).set({ status: "failed", finishedAt: new Date() }).where(eq(volumeBackups.id, row.id));
      await notifyTeam(row.teamId, "backup.failed", `${row.operation === "restore" ? "Restore" : "Backup"} do volume ${row.label} falhou`, message, "error");
    } finally {
      conn?.end();
    }
  };
}

/** Keeps the newest few archives of each volume; the rest go, files first. */
async function applyRetention(conn: Client, applicationId: string, volumeId: string) {
  const rows = await db
    .select()
    .from(volumeBackups)
    .where(and(eq(volumeBackups.ownerId, applicationId), eq(volumeBackups.volumeId, volumeId), eq(volumeBackups.operation, "backup"), eq(volumeBackups.status, "success")))
    .orderBy(desc(volumeBackups.createdAt));
  for (const old of rows.slice(KEEP_VOLUME_BACKUPS)) {
    if (old.filePath) await execStream(conn, `rm -f ${shellQuote(old.filePath)}`, () => undefined);
    await db.delete(volumeBackups).where(eq(volumeBackups.id, old.id));
  }
}
