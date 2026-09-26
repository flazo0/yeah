import { and, eq } from "drizzle-orm";
import { s3Storages, servers, type S3Storage, type VolumeBackup } from "@yeah/db";
import type { VolumeBackupDto } from "@yeah/shared";
import { connectSsh, execStream, readRemoteFile, shellQuote } from "@yeah/ssh";
import { s3ClientFor } from "@yeah/storage";
import { db } from "./db";

// Shared by the application and the service volume-backup routes: the DTO, the S3 destination check and
// what to do with an archive's file (download, delete) wherever it lives.

export function volumeBackupDto(b: VolumeBackup): VolumeBackupDto {
  return {
    id: b.id,
    volumeId: b.volumeId,
    inS3: b.s3StorageId !== null,
    label: b.label,
    operation: b.operation,
    status: b.status,
    log: b.log,
    sizeBytes: b.sizeBytes,
    sourceBackupId: b.sourceBackupId,
    startedAt: b.startedAt ? b.startedAt.toISOString() : null,
    finishedAt: b.finishedAt ? b.finishedAt.toISOString() : null,
    createdAt: b.createdAt.toISOString(),
  };
}

/** The team's S3 destination, or undefined when the id is not one of theirs. */
export async function findTeamStorage(teamId: string, storageId: string): Promise<S3Storage | undefined> {
  const [storage] = await db.select().from(s3Storages).where(and(eq(s3Storages.id, storageId), eq(s3Storages.teamId, teamId))).limit(1);
  return storage;
}

async function sshTo(serverId: string) {
  const [server] = await db.select().from(servers).where(eq(servers.id, serverId)).limit(1);
  if (!server) return null;
  return connectSsh({ host: server.host, port: server.port, username: server.sshUser, privateKey: server.privateKey, timeoutMs: server.sshTimeoutSeconds * 1000 });
}

/** A download response: an S3 presigned redirect, or a bounded SFTP read (same exception as database backups). */
export async function volumeBackupDownload(b: VolumeBackup, serverId: string): Promise<Response | null> {
  if (!b.filePath) return null;
  if (b.s3StorageId) {
    const [storage] = await db.select().from(s3Storages).where(eq(s3Storages.id, b.s3StorageId)).limit(1);
    if (!storage) return null;
    return Response.redirect(s3ClientFor(storage).presign(b.filePath, { expiresIn: 300 }), 302);
  }
  const conn = await sshTo(serverId);
  if (!conn) return null;
  try {
    const buf = await readRemoteFile(conn, b.filePath);
    return new Response(new Uint8Array(buf), { headers: { "Content-Type": "application/gzip", "Content-Disposition": `attachment; filename="${b.filePath.split("/").pop()}"` } });
  } finally {
    conn.end();
  }
}

/** Removes an archive's file (S3 object or file on the server) — best effort; only a backup row owns a file. */
export async function removeVolumeBackupFile(b: VolumeBackup, serverId: string): Promise<void> {
  if (b.operation !== "backup" || !b.filePath) return;
  try {
    if (b.s3StorageId) {
      const [storage] = await db.select().from(s3Storages).where(eq(s3Storages.id, b.s3StorageId)).limit(1);
      if (storage) await s3ClientFor(storage).delete(b.filePath);
      return;
    }
    const conn = await sshTo(serverId);
    if (!conn) return;
    try {
      await execStream(conn, `rm -f ${shellQuote(b.filePath)}`, () => undefined);
    } finally {
      conn.end();
    }
  } catch (err) {
    console.error("[api] failed to delete volume backup file:", err);
  }
}
