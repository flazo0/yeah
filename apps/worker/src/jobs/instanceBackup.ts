import { eq } from "drizzle-orm";
import { getInstanceBackupSettings, s3Storages, servers, updateInstanceBackupColumns } from "@yeah/db";
import { connectSsh, execStream, openRemoteReadStream, removeRemoteFile, shellQuote } from "@yeah/ssh";
import { buildInstanceDumpCommand, INSTANCE_BACKUP_PREFIX, INSTANCE_BACKUP_STAGING_DIR, instanceBackupKey, instanceBackupsToDelete, isInstanceBackupDue, PANEL_INSTALL_DIR } from "@yeah/shared";
import { s3ClientFor, uploadStream } from "@yeah/storage";
import type { InstanceBackupJobData } from "@yeah/queue";
import type { Job } from "bullmq";
import { db } from "../lib/db";
import { notifyTeam } from "../lib/notify";

/** Scheduled (and "back up now") dump of the panel's own database, uploaded to S3 as a stream. */
export function makeInstanceBackupProcessor() {
  return async function instanceBackup(job: Job<InstanceBackupJobData>) {
    const settings = await getInstanceBackupSettings(db);
    const force = job.data.force === true;
    if (!isInstanceBackupDue(new Date(), { enabled: settings.enabled, storageId: settings.storageId, hourUtc: settings.hourUtc, lastAt: settings.lastAt }, force)) return;

    const [storage] = settings.storageId ? await db.select().from(s3Storages).where(eq(s3Storages.id, settings.storageId)).limit(1) : [];
    const [server] = await db.select().from(servers).where(eq(servers.isPlatformHost, true)).limit(1);
    await updateInstanceBackupColumns(db, { backupLastStatus: "running", backupLastError: null });

    let notifyTeamId: string | null = storage?.teamId ?? server?.teamId ?? null;
    try {
      if (!storage) throw new Error("the backup destination no longer exists: choose another one in Settings");
      if (!server) throw new Error("no server hosts the panel, so there is no database to dump from");
      notifyTeamId = storage.teamId;

      const now = new Date();
      const key = instanceBackupKey(now);
      const remote = `${INSTANCE_BACKUP_STAGING_DIR}/${key.slice(INSTANCE_BACKUP_PREFIX.length)}`;
      const conn = await connectSsh({ host: server.host, port: server.port, username: server.sshUser, privateKey: server.privateKey, timeoutMs: server.sshTimeoutSeconds * 1000 });
      let sizeBytes = 0;
      try {
        let output = "";
        const dump = await execStream(conn, buildInstanceDumpCommand(PANEL_INSTALL_DIR, remote), (chunk) => {
          output += chunk;
        });
        if (dump.exitCode !== 0) throw new Error(`the database dump failed on ${server.name} (is the panel installed in ${PANEL_INSTALL_DIR}?) ${output.trim().slice(0, 200)}`);
        let sizeOut = "";
        await execStream(conn, `wc -c < ${shellQuote(remote)}`, (c) => (sizeOut += c));
        sizeBytes = Number.parseInt(sizeOut.trim(), 10) || 0;
        const client = s3ClientFor(storage);
        try {
          const { stream } = await openRemoteReadStream(conn, remote);
          const sent = await uploadStream(client, key, stream);
          if (sizeBytes > 0 && sent !== sizeBytes) throw new Error(`the upload sent ${sent} bytes but the dump has ${sizeBytes}`);
        } finally {
          // The copy on the host was only a staging area; the one in S3 is the backup.
          await removeRemoteFile(conn, remote);
        }
        // retention: keep the newest N objects that are ours
        const listed = await client.list({ prefix: INSTANCE_BACKUP_PREFIX, maxKeys: 1000 });
        for (const old of instanceBackupsToDelete((listed.contents ?? []).map((o) => o.key), settings.retention)) await client.delete(old).catch(() => undefined);
      } finally {
        conn.end();
      }
      await updateInstanceBackupColumns(db, { backupLastAt: now, backupLastStatus: "success", backupLastError: null, backupLastSizeBytes: sizeBytes });
      console.log(`[worker] instance-backup: ${key} (${sizeBytes} bytes) uploaded`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[worker] instance-backup: failed:", message);
      await updateInstanceBackupColumns(db, { backupLastStatus: "failed", backupLastError: message.slice(0, 500) });
      if (notifyTeamId) await notifyTeam(notifyTeamId, "backup.failed", "Backup of the panel's database failed", message, "error");
    }
  };
}
