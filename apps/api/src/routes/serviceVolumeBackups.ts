import { Elysia, t } from "elysia";
import { and, desc, eq } from "drizzle-orm";
import { volumeBackups } from "@yeah/db";
import { composeNamedVolumes } from "@yeah/shared";
import { requireEnvironmentScope } from "../lib/scope";
import { findTeamStorage, removeVolumeBackupFile, volumeBackupDownload, volumeBackupDto } from "../lib/volumeBackupFiles";
import { db } from "../lib/db";
import { getUserFromSessionId, SESSION_COOKIE } from "../lib/session";
import { assertMember } from "../lib/access";
import { volumeBackupQueue } from "../lib/queue";
import { loadService } from "./services";

const stackProject = (serviceId: string) => `yeah-svc-${serviceId}`;

// Backups of the named volumes a stack service declares in its compose file: a tar.gz on the server per
// volume (newest five kept), restorable (the stack is stopped around it) and downloadable. Same model as
// the application volume backups; the volume is identified by its key in the compose file (the row's label).
export const serviceVolumeBackupRoutes = new Elysia({
  prefix: "/teams/:teamId/projects/:projectId/environments/:environmentId/services",
})
  .onBeforeHandle(requireEnvironmentScope)
  .derive(async ({ cookie, params }) => {
    const p = params as Record<string, string>;
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) return { sctx: { error: "unauthorized" as const, status: 401 } };
    if (!(await assertMember(p.teamId!, user.id))) return { sctx: { error: "forbidden" as const, status: 403 } };
    const row = p.serviceId ? await loadService(p.environmentId!, p.serviceId) : undefined;
    if (!row) return { sctx: { error: "service not found" as const, status: 404 } };
    if (!row.service.composeContent) return { sctx: { error: "só stacks têm volumes com backup aqui" as const, status: 400 } };
    return { sctx: { service: row.service } };
  })
  .get("/:serviceId/volumes", async ({ sctx, set }) => {
    if ("error" in sctx) {
      set.status = sctx.status;
      return { error: sctx.error };
    }
    return { volumes: composeNamedVolumes(sctx.service.composeContent!, stackProject(sctx.service.id)) };
  })
  .get("/:serviceId/volume-backups", async ({ sctx, set }) => {
    if ("error" in sctx) {
      set.status = sctx.status;
      return { error: sctx.error };
    }
    const rows = await db.select().from(volumeBackups).where(and(eq(volumeBackups.ownerType, "service"), eq(volumeBackups.ownerId, sctx.service.id))).orderBy(desc(volumeBackups.createdAt)).limit(50);
    return { backups: rows.map(volumeBackupDto) };
  })
  .post("/:serviceId/volumes/:key/backup", async ({ sctx, params, body, set }) => {
    if ("error" in sctx) {
      set.status = sctx.status;
      return { error: sctx.error };
    }
    const volume = composeNamedVolumes(sctx.service.composeContent!, stackProject(sctx.service.id)).find((v) => v.key === params.key);
    if (!volume) {
      set.status = 404;
      return { error: "volume not found" };
    }
    // A volume that was never created would be made empty by the helper container and then trip compose.
    if (sctx.service.status === "idle") {
      set.status = 409;
      return { error: "o serviço ainda não foi implantado — não há dados pra copiar" };
    }
    const [last] = await db.select().from(volumeBackups).where(and(eq(volumeBackups.ownerType, "service"), eq(volumeBackups.ownerId, sctx.service.id), eq(volumeBackups.label, volume.key))).orderBy(desc(volumeBackups.createdAt)).limit(1);
    if (last && (last.status === "queued" || last.status === "running")) {
      set.status = 409;
      return { error: "já há uma operação em andamento neste volume" };
    }
    const storageId = body?.storageId ?? null;
    if (storageId && !(await findTeamStorage(sctx.service.teamId, storageId))) {
      set.status = 404;
      return { error: "destino S3 não encontrado" };
    }
    const [row] = await db.insert(volumeBackups).values({ teamId: sctx.service.teamId, ownerType: "service", ownerId: sctx.service.id, label: volume.key, operation: "backup", s3StorageId: storageId }).returning();
    await volumeBackupQueue.add("backup", { backupId: row!.id });
    return { backup: volumeBackupDto(row!) };
  }, { body: t.Optional(t.Object({ storageId: t.Optional(t.Union([t.String(), t.Null()])) })) })
  .post("/:serviceId/volume-backups/:backupId/restore", async ({ sctx, params, set }) => {
    if ("error" in sctx) {
      set.status = sctx.status;
      return { error: sctx.error };
    }
    const [source] = await db.select().from(volumeBackups).where(and(eq(volumeBackups.id, params.backupId), eq(volumeBackups.ownerType, "service"), eq(volumeBackups.ownerId, sctx.service.id), eq(volumeBackups.operation, "backup"))).limit(1);
    if (!source || source.status !== "success" || !source.filePath) {
      set.status = 404;
      return { error: "backup não encontrado (ou não terminou com sucesso)" };
    }
    if (!composeNamedVolumes(sctx.service.composeContent!, stackProject(sctx.service.id)).some((v) => v.key === source.label)) {
      set.status = 409;
      return { error: `o volume "${source.label}" não está mais no compose do serviço` };
    }
    if (sctx.service.status === "provisioning") {
      set.status = 409;
      return { error: "há uma operação em andamento neste serviço — espere terminar" };
    }
    const [row] = await db
      .insert(volumeBackups)
      .values({ teamId: sctx.service.teamId, ownerType: "service", ownerId: sctx.service.id, label: source.label, operation: "restore", sourceBackupId: source.id })
      .returning();
    await volumeBackupQueue.add("restore", { backupId: row!.id });
    return { backup: volumeBackupDto(row!) };
  })
  .get("/:serviceId/volume-backups/:backupId/download", async ({ sctx, params, set }) => {
    if ("error" in sctx) {
      set.status = sctx.status;
      return { error: sctx.error };
    }
    const [b] = await db.select().from(volumeBackups).where(and(eq(volumeBackups.id, params.backupId), eq(volumeBackups.ownerType, "service"), eq(volumeBackups.ownerId, sctx.service.id), eq(volumeBackups.operation, "backup"))).limit(1);
    if (!b || !b.filePath) {
      set.status = 404;
      return { error: "backup file not found" };
    }
    const res = await volumeBackupDownload(b, sctx.service.serverId);
    if (!res) {
      set.status = 404;
      return { error: "backup file not found" };
    }
    return res;
  })
  .delete("/:serviceId/volume-backups/:backupId", async ({ sctx, params, set }) => {
    if ("error" in sctx) {
      set.status = sctx.status;
      return { error: sctx.error };
    }
    const [b] = await db.select().from(volumeBackups).where(and(eq(volumeBackups.id, params.backupId), eq(volumeBackups.ownerType, "service"), eq(volumeBackups.ownerId, sctx.service.id))).limit(1);
    if (!b) {
      set.status = 404;
      return { error: "backup not found" };
    }
    await removeVolumeBackupFile(b, sctx.service.serverId);
    await db.delete(volumeBackups).where(eq(volumeBackups.id, b.id));
    return { ok: true };
  });
