import { Elysia, t } from "elysia";
import { and, desc, eq } from "drizzle-orm";
import { applicationVolumes, servers, volumeBackups, type VolumeBackup } from "@yeah/db";
import type { VolumeBackupDto } from "@yeah/shared";
import { connectSsh, execStream, readRemoteFile, shellQuote } from "@yeah/ssh";
import { requireEnvironmentScope } from "../lib/scope";
import { db } from "../lib/db";
import { getUserFromSessionId, SESSION_COOKIE } from "../lib/session";
import { assertMember } from "../lib/access";
import { volumeBackupQueue } from "../lib/queue";
import { loadApplication } from "./applications";

function toDto(b: VolumeBackup): VolumeBackupDto {
  return {
    id: b.id,
    volumeId: b.volumeId,
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

// Backups of an application's persistent storage (named volumes, host directories and file volumes):
// a tar.gz on the server per volume, kept in the newest five, restorable and downloadable. Compose
// applications manage their own volumes, so they have none here.
export const volumeBackupRoutes = new Elysia({
  prefix: "/teams/:teamId/projects/:projectId/environments/:environmentId/applications",
})
  .onBeforeHandle(requireEnvironmentScope)
  .derive(async ({ cookie, params }) => {
    const p = params as Record<string, string>;
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) return { vctx: { error: "unauthorized" as const, status: 401 } };
    if (!(await assertMember(p.teamId!, user.id))) return { vctx: { error: "forbidden" as const, status: 403 } };
    const row = p.applicationId ? await loadApplication(p.environmentId!, p.applicationId) : undefined;
    if (!row) return { vctx: { error: "application not found" as const, status: 404 } };
    return { vctx: { application: row.application } };
  })
  .get("/:applicationId/volume-backups", async ({ vctx, set }) => {
    if ("error" in vctx) {
      set.status = vctx.status;
      return { error: vctx.error };
    }
    const rows = await db.select().from(volumeBackups).where(and(eq(volumeBackups.ownerType, "application"), eq(volumeBackups.ownerId, vctx.application.id))).orderBy(desc(volumeBackups.createdAt)).limit(50);
    return { backups: rows.map(toDto) };
  })
  .post("/:applicationId/volumes/:volumeId/backup", async ({ vctx, params, set }) => {
    if ("error" in vctx) {
      set.status = vctx.status;
      return { error: vctx.error };
    }
    if (vctx.application.buildPack === "docker_compose") {
      set.status = 400;
      return { error: "aplicações Docker Compose gerenciam os próprios volumes" };
    }
    const [volume] = await db.select().from(applicationVolumes).where(and(eq(applicationVolumes.id, params.volumeId), eq(applicationVolumes.applicationId, vctx.application.id))).limit(1);
    if (!volume) {
      set.status = 404;
      return { error: "volume not found" };
    }
    const busy = await db.select({ id: volumeBackups.id }).from(volumeBackups).where(and(eq(volumeBackups.ownerId, vctx.application.id), eq(volumeBackups.volumeId, volume.id))).orderBy(desc(volumeBackups.createdAt)).limit(1);
    const [last] = busy.length ? await db.select().from(volumeBackups).where(eq(volumeBackups.id, busy[0]!.id)) : [];
    if (last && (last.status === "queued" || last.status === "running")) {
      set.status = 409;
      return { error: "já há uma operação em andamento neste volume" };
    }
    const [row] = await db.insert(volumeBackups).values({ teamId: vctx.application.teamId, ownerType: "application", ownerId: vctx.application.id, volumeId: volume.id, label: volume.mountPath, operation: "backup" }).returning();
    await volumeBackupQueue.add("backup", { backupId: row!.id });
    return { backup: toDto(row!) };
  })
  .post("/:applicationId/volume-backups/:backupId/restore", async ({ vctx, params, set }) => {
    if ("error" in vctx) {
      set.status = vctx.status;
      return { error: vctx.error };
    }
    const [source] = await db.select().from(volumeBackups).where(and(eq(volumeBackups.id, params.backupId), eq(volumeBackups.ownerId, vctx.application.id), eq(volumeBackups.operation, "backup"))).limit(1);
    if (!source || source.status !== "success" || !source.filePath) {
      set.status = 404;
      return { error: "backup não encontrado (ou não terminou com sucesso)" };
    }
    const [row] = await db
      .insert(volumeBackups)
      .values({ teamId: vctx.application.teamId, ownerType: "application", ownerId: vctx.application.id, volumeId: source.volumeId, label: source.label, operation: "restore", sourceBackupId: source.id })
      .returning();
    await volumeBackupQueue.add("restore", { backupId: row!.id });
    return { backup: toDto(row!) };
  })
  .get("/:applicationId/volume-backups/:backupId/download", async ({ vctx, params, set }) => {
    if ("error" in vctx) {
      set.status = vctx.status;
      return { error: vctx.error };
    }
    const [b] = await db.select().from(volumeBackups).where(and(eq(volumeBackups.id, params.backupId), eq(volumeBackups.ownerId, vctx.application.id), eq(volumeBackups.operation, "backup"))).limit(1);
    if (!b || !b.filePath) {
      set.status = 404;
      return { error: "backup file not found" };
    }
    const [server] = await db.select().from(servers).where(eq(servers.id, vctx.application.serverId)).limit(1);
    if (!server) {
      set.status = 404;
      return { error: "server not found" };
    }
    // Bounded SFTP read for a download the browser is waiting on (same exception as database backups).
    const conn = await connectSsh({ host: server.host, port: server.port, username: server.sshUser, privateKey: server.privateKey, timeoutMs: server.sshTimeoutSeconds * 1000 });
    try {
      const buf = await readRemoteFile(conn, b.filePath);
      return new Response(new Uint8Array(buf), { headers: { "Content-Type": "application/gzip", "Content-Disposition": `attachment; filename="${b.filePath.split("/").pop()}"` } });
    } finally {
      conn.end();
    }
  })
  .delete("/:applicationId/volume-backups/:backupId", async ({ vctx, params, set }) => {
    if ("error" in vctx) {
      set.status = vctx.status;
      return { error: vctx.error };
    }
    const [b] = await db.select().from(volumeBackups).where(and(eq(volumeBackups.id, params.backupId), eq(volumeBackups.ownerId, vctx.application.id))).limit(1);
    if (!b) {
      set.status = 404;
      return { error: "backup not found" };
    }
    // Only an archive owns a file; a restore row merely points at one.
    if (b.operation === "backup" && b.filePath) {
      const [server] = await db.select().from(servers).where(eq(servers.id, vctx.application.serverId)).limit(1);
      if (server) {
        try {
          const conn = await connectSsh({ host: server.host, port: server.port, username: server.sshUser, privateKey: server.privateKey, timeoutMs: server.sshTimeoutSeconds * 1000 });
          try {
            await execStream(conn, `rm -f ${shellQuote(b.filePath)}`, () => undefined);
          } finally {
            conn.end();
          }
        } catch (err) {
          console.error("[api] failed to delete volume backup file:", err);
        }
      }
    }
    await db.delete(volumeBackups).where(eq(volumeBackups.id, b.id));
    return { ok: true };
  });

void t;
