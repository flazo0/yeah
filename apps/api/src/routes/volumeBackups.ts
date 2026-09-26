import { Elysia, t } from "elysia";
import { and, desc, eq } from "drizzle-orm";
import { applicationVolumes, volumeBackups } from "@yeah/db";
import { requireEnvironmentScope } from "../lib/scope";
import { findTeamStorage, removeVolumeBackupFile, volumeBackupDownload, volumeBackupDto } from "../lib/volumeBackupFiles";
import { db } from "../lib/db";
import { getUserFromSessionId, SESSION_COOKIE } from "../lib/session";
import { assertMember } from "../lib/access";
import { volumeBackupQueue } from "../lib/queue";
import { loadApplication } from "./applications";

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
    return { backups: rows.map(volumeBackupDto) };
  })
  .post("/:applicationId/volumes/:volumeId/backup", async ({ vctx, params, body, set }) => {
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
    const storageId = body?.storageId ?? null;
    if (storageId && !(await findTeamStorage(vctx.application.teamId, storageId))) {
      set.status = 404;
      return { error: "destino S3 não encontrado" };
    }
    const [row] = await db.insert(volumeBackups).values({ teamId: vctx.application.teamId, ownerType: "application", ownerId: vctx.application.id, volumeId: volume.id, label: volume.mountPath, operation: "backup", s3StorageId: storageId }).returning();
    await volumeBackupQueue.add("backup", { backupId: row!.id });
    return { backup: volumeBackupDto(row!) };
  }, { body: t.Optional(t.Object({ storageId: t.Optional(t.Union([t.String(), t.Null()])) })) })
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
    return { backup: volumeBackupDto(row!) };
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
    const res = await volumeBackupDownload(b, vctx.application.serverId);
    if (!res) {
      set.status = 404;
      return { error: "backup file not found" };
    }
    return res;
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
    await removeVolumeBackupFile(b, vctx.application.serverId);
    await db.delete(volumeBackups).where(eq(volumeBackups.id, b.id));
    return { ok: true };
  });

void t;
