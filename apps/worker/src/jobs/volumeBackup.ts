import { and, desc, eq, type SQL } from "drizzle-orm";
import { applicationVolumes, applications, servers, services, volumeBackups, type VolumeBackup } from "@yeah/db";
import { composeLifecycleCommand, composeNamedVolumes } from "@yeah/shared";
import { connectSsh, execStream, shellQuote, type Client } from "@yeah/ssh";
import type { VolumeBackupJobData } from "@yeah/queue";
import type { Job } from "bullmq";
import { db } from "../lib/db";
import { notifyTeam } from "../lib/notify";
import { stackProject } from "./provisionService.commands";
import {
  buildNamedVolumeBackupCommand,
  buildNamedVolumeRestoreCommand,
  buildVolumeBackupCommand,
  buildVolumeRestoreCommands,
  KEEP_VOLUME_BACKUPS,
  stackVolumeArchiveName,
  volumeArchiveName,
  volumeBackupsDir,
  type RestoreCommands,
  type VolumeSource,
} from "./volumeBackup.commands";

/** What one backup/restore needs to know about its owner (an application volume or a stack volume). */
interface Target {
  serverId: string;
  ownerId: string;
  label: string;
  archiveName: string;
  backup: (archive: string) => string;
  restore: (archive: string) => RestoreCommands;
  /** Retention: which older archives count as "the same volume". */
  sameVolume: SQL | undefined;
  stopLabel: string;
  startLabel: string;
}

/** Runs one volume_backups row: an archive of a volume, or the restore of an earlier archive. */
export function makeVolumeBackupProcessor() {
  return async function volumeBackup(job: Job<VolumeBackupJobData>) {
    const [row] = await db.select().from(volumeBackups).where(eq(volumeBackups.id, job.data.backupId)).limit(1);
    if (!row) return;

    let log = "";
    const append = async (text: string) => {
      log += text;
      await db.update(volumeBackups).set({ log }).where(eq(volumeBackups.id, row.id));
    };
    await db.update(volumeBackups).set({ status: "running", startedAt: new Date() }).where(eq(volumeBackups.id, row.id));

    let conn: Client | null = null;
    try {
      // A restore names its source archive; a backup names the volume directly.
      const isRestore = row.operation === "restore";
      let sourceRow = row;
      if (isRestore) {
        const [src] = row.sourceBackupId ? await db.select().from(volumeBackups).where(eq(volumeBackups.id, row.sourceBackupId)).limit(1) : [];
        if (!src || src.ownerId !== row.ownerId || !src.filePath) throw new Error("o backup de origem não existe mais");
        sourceRow = src;
      }
      const target = row.ownerType === "service" ? await serviceTarget(row, sourceRow) : await applicationTarget(row, sourceRow);
      const [server] = await db.select().from(servers).where(eq(servers.id, target.serverId)).limit(1);
      if (!server) throw new Error("o servidor não existe mais");

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

      if (!isRestore) {
        const dir = volumeBackupsDir(target.ownerId);
        const archive = `${dir}/${target.archiveName}`;
        await run(`mkdir -p ${shellQuote(dir)}`, "preparando a pasta");
        await run(target.backup(archive), `arquivando ${target.label}`);
        let size = "";
        await execStream(conn, `wc -c < ${shellQuote(archive)}`, (c) => (size += c));
        await db.update(volumeBackups).set({ status: "success", finishedAt: new Date(), filePath: archive, sizeBytes: Number.parseInt(size.trim(), 10) || 0 }).where(eq(volumeBackups.id, row.id));
        await append("\n\x1b[32mBackup concluído.\x1b[0m\n");
        await applyRetention(conn, target);
      } else {
        const commands = target.restore(sourceRow.filePath!);
        await run(commands.stop, target.stopLabel);
        try {
          await run(commands.replace, `restaurando ${target.label}`);
        } finally {
          await run(commands.start, target.startLabel);
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

async function applicationTarget(row: VolumeBackup, sourceRow: VolumeBackup): Promise<Target> {
  const [application] = await db.select().from(applications).where(eq(applications.id, row.ownerId)).limit(1);
  if (!application) throw new Error("aplicação ou servidor não existe mais");
  const [volume] = sourceRow.volumeId ? await db.select().from(applicationVolumes).where(and(eq(applicationVolumes.id, sourceRow.volumeId), eq(applicationVolumes.applicationId, application.id))).limit(1) : [];
  if (!volume) throw new Error("o volume não existe mais (foi removido da aplicação)");
  const source: VolumeSource = { kind: volume.kind, id: volume.id, hostPath: volume.hostPath, applicationId: application.id };
  return {
    serverId: application.serverId,
    ownerId: application.id,
    label: volume.mountPath,
    archiveName: volumeArchiveName(volume.id),
    backup: (archive) => buildVolumeBackupCommand(source, archive),
    restore: (archive) => buildVolumeRestoreCommands(source, archive, `yeah-app-${application.id}`),
    sameVolume: eq(volumeBackups.volumeId, volume.id),
    stopLabel: "parando a aplicação",
    startLabel: "iniciando a aplicação",
  };
}

async function serviceTarget(row: VolumeBackup, sourceRow: VolumeBackup): Promise<Target> {
  const [service] = await db.select().from(services).where(eq(services.id, row.ownerId)).limit(1);
  if (!service || !service.composeContent) throw new Error("o serviço não existe mais");
  const project = stackProject(service.id);
  const volume = composeNamedVolumes(service.composeContent, project).find((v) => v.key === sourceRow.label);
  if (!volume) throw new Error(`o volume "${sourceRow.label}" não está mais no compose do serviço`);
  return {
    serverId: service.serverId,
    ownerId: service.id,
    label: volume.key,
    archiveName: stackVolumeArchiveName(volume.key),
    backup: (archive) => buildNamedVolumeBackupCommand(volume.dockerName, archive),
    restore: (archive) => ({
      stop: composeLifecycleCommand("stop", project, 10) + " || true",
      replace: buildNamedVolumeRestoreCommand(volume.dockerName, archive),
      start: composeLifecycleCommand("start", project, 10) + " || true",
    }),
    sameVolume: eq(volumeBackups.label, volume.key),
    stopLabel: "parando os containers",
    startLabel: "iniciando os containers",
  };
}

/** Keeps the newest few archives of each volume; the rest go, files first. */
async function applyRetention(conn: Client, target: Target) {
  const rows = await db
    .select()
    .from(volumeBackups)
    .where(and(eq(volumeBackups.ownerId, target.ownerId), target.sameVolume, eq(volumeBackups.operation, "backup"), eq(volumeBackups.status, "success")))
    .orderBy(desc(volumeBackups.createdAt));
  for (const old of rows.slice(KEEP_VOLUME_BACKUPS)) {
    if (old.filePath) await execStream(conn, `rm -f ${shellQuote(old.filePath)}`, () => undefined);
    await db.delete(volumeBackups).where(eq(volumeBackups.id, old.id));
  }
}
