import { Elysia, t } from "elysia";
import { and, desc, eq, inArray } from "drizzle-orm";
import { backupExecutions, backupSchedules, databaseRestores, s3Storages, servers, type BackupExecution, type BackupSchedule, type Database, type DatabaseRestore } from "@yeah/db";
import { DATABASE_ENGINES, type DatabaseRestoreDto } from "@yeah/shared";
import { addBackupSchedule, removeBackupSchedule } from "@yeah/queue";
import { connectSsh, execStream, readRemoteFile, shellQuote, writeRemoteFile } from "@yeah/ssh";
import { s3ClientFor } from "@yeah/storage";
import { db } from "../lib/db";
import { getUserFromSessionId, SESSION_COOKIE } from "../lib/session";
import { assertMember } from "../lib/access";
import { databaseBackupQueue, databaseRestoreQueue } from "../lib/queue";
import { isValidStorageForTeam, loadDatabase, toExecutionDto, toScheduleDto } from "./databases";

// Backup schedules, their executions, restore and upload. Every route resolves the database through
// its environment first, and every schedule/execution through that database — an id from another
// team's database never reaches a row here.

const INCLUDED_DB = /^[A-Za-z0-9_]{1,63}$/;
const MAX_UPLOAD_BYTES = 120 * 1024 * 1024; // Bun's default request body limit is 128 MB

function toRestoreDto(r: DatabaseRestore): DatabaseRestoreDto {
  return {
    id: r.id,
    databaseId: r.databaseId,
    status: r.status,
    sourceLabel: r.sourceLabel,
    log: r.log,
    startedAt: r.startedAt ? r.startedAt.toISOString() : null,
    finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  };
}

/** Normalizes the "databases to include" list; returns an error string for a bad name. */
function parseIncluded(input: string | null | undefined): { value: string | null; error?: string } {
  const names = [...new Set((input ?? "").split(/[,\s]+/).map((n) => n.trim()).filter(Boolean))];
  if (names.length === 0) return { value: null };
  const bad = names.find((n) => !INCLUDED_DB.test(n));
  if (bad) return { value: null, error: `nome de banco inválido: ${bad} (use letras, números e _)` };
  if (names.length > 20) return { value: null, error: "no máximo 20 bancos por backup" };
  return { value: names.join(",") };
}

async function sshTo(serverId: string) {
  const [server] = await db.select().from(servers).where(eq(servers.id, serverId)).limit(1);
  if (!server) return null;
  const conn = await connectSsh({ host: server.host, port: server.port, username: server.sshUser, privateKey: server.privateKey, timeoutMs: server.sshTimeoutSeconds * 1000 });
  return conn;
}

/** Removes a backup's file (S3 object or local file on the server) — best effort, the row is what the user asked to drop. */
async function deleteBackupFile(execution: BackupExecution, database: Database): Promise<void> {
  if (!execution.filePath) return;
  if (execution.s3StorageId) {
    const [storage] = await db.select().from(s3Storages).where(eq(s3Storages.id, execution.s3StorageId)).limit(1);
    if (storage) {
      try {
        await s3ClientFor(storage).delete(execution.filePath);
      } catch (err) {
        console.error(`[api] failed to delete S3 object for execution ${execution.id}:`, err);
      }
    }
    return;
  }
  try {
    const conn = await sshTo(database.serverId);
    if (!conn) return;
    try {
      await execStream(conn, `rm -f ${shellQuote(execution.filePath)}`, () => undefined);
    } finally {
      conn.end();
    }
  } catch (err) {
    console.error(`[api] failed to delete backup file ${execution.filePath}:`, err);
  }
}

export const databaseBackupRoutes = new Elysia({
  prefix: "/teams/:teamId/projects/:projectId/environments/:environmentId/databases",
})
  .derive(async ({ cookie, params, set }) => {
    // Resolved once for every route below: the caller, membership and the database itself.
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) return { ctx: { error: "unauthorized" as const, status: 401 } };
    if (!(await assertMember(params.teamId, user.id))) return { ctx: { error: "forbidden" as const, status: 403 } };
    const row = await loadDatabase(params.environmentId, (params as Record<string, string>).databaseId as string);
    if (!row) return { ctx: { error: "database not found" as const, status: 404 } };
    void set;
    return { ctx: { database: row.database } };
  })
  .get("/:databaseId/backup-schedule", async ({ ctx, params, set }) => {
    if ("error" in ctx) {
      set.status = ctx.status;
      return { error: ctx.error };
    }
    const [schedule] = await db.select().from(backupSchedules).where(eq(backupSchedules.databaseId, params.databaseId)).limit(1);
    return { schedule: schedule ? toScheduleDto(schedule) : null };
  })
  .post(
    "/:databaseId/backup-schedule",
    async ({ ctx, params, body, set }) => {
      if ("error" in ctx) {
        set.status = ctx.status;
        return { error: ctx.error };
      }
      const info = DATABASE_ENGINES[ctx.database.engine];
      if (!info.supportsBackup) {
        set.status = 400;
        return { error: `${info.label} ainda não tem backup pelo painel` };
      }
      const [existing] = await db.select().from(backupSchedules).where(eq(backupSchedules.databaseId, params.databaseId)).limit(1);
      if (existing) {
        set.status = 409;
        return { error: "a backup schedule already exists — delete it before creating a new one" };
      }
      if (!(await isValidStorageForTeam(params.teamId, body.storageId))) {
        set.status = 404;
        return { error: "storage not found" };
      }
      const included = parseIncluded(body.databases);
      if (included.error) {
        set.status = 400;
        return { error: included.error };
      }
      const [schedule] = await db
        .insert(backupSchedules)
        .values({
          databaseId: params.databaseId,
          cron: body.cron,
          timezone: body.timezone ?? "UTC",
          timeoutSeconds: body.timeoutSeconds ?? 3600,
          retentionCount: body.retentionCount ?? 7,
          retentionDays: body.retentionDays ?? 0,
          retentionSizeGb: body.retentionSizeGb ?? 0,
          storageId: body.storageId ?? null,
          databasesToInclude: included.value,
        })
        .returning();
      if (!schedule) {
        set.status = 500;
        return { error: "failed to create backup schedule" };
      }
      try {
        await addBackupSchedule(databaseBackupQueue, schedule.id, schedule.cron, schedule.timezone);
      } catch (err) {
        // A malformed cron or an unknown timezone is rejected by the scheduler — do not leave the row behind.
        await db.delete(backupSchedules).where(eq(backupSchedules.id, schedule.id));
        set.status = 400;
        return { error: `agendamento inválido: ${err instanceof Error ? err.message : "cron ou timezone"}` };
      }
      return { schedule: toScheduleDto(schedule) };
    },
    {
      body: t.Object({
        cron: t.String({ minLength: 1 }),
        timezone: t.Optional(t.String()),
        timeoutSeconds: t.Optional(t.Number()),
        retentionCount: t.Optional(t.Number()),
        retentionDays: t.Optional(t.Number()),
        retentionSizeGb: t.Optional(t.Number()),
        storageId: t.Optional(t.Nullable(t.String())),
        databases: t.Optional(t.Nullable(t.String({ maxLength: 1000 }))),
      }),
    },
  )
  .put(
    "/:databaseId/backup-schedule/:scheduleId",
    async ({ ctx, params, body, set }) => {
      if ("error" in ctx) {
        set.status = ctx.status;
        return { error: ctx.error };
      }
      const [existing] = await db.select().from(backupSchedules).where(and(eq(backupSchedules.id, params.scheduleId), eq(backupSchedules.databaseId, params.databaseId))).limit(1);
      if (!existing) {
        set.status = 404;
        return { error: "backup schedule not found" };
      }
      // Tri-state: absent = keep current storage, explicit null = switch to local, a string = switch S3 destination.
      const nextStorageId = "storageId" in body ? (body.storageId ?? null) : existing.storageId;
      if (!(await isValidStorageForTeam(params.teamId, nextStorageId))) {
        set.status = 404;
        return { error: "storage not found" };
      }
      let nextIncluded = existing.databasesToInclude;
      if ("databases" in body) {
        const included = parseIncluded(body.databases);
        if (included.error) {
          set.status = 400;
          return { error: included.error };
        }
        nextIncluded = included.value;
      }
      const next = {
        cron: body.cron ?? existing.cron,
        timezone: body.timezone ?? existing.timezone,
        timeoutSeconds: body.timeoutSeconds ?? existing.timeoutSeconds,
        retentionCount: body.retentionCount ?? existing.retentionCount,
        retentionDays: body.retentionDays ?? existing.retentionDays,
        retentionSizeGb: body.retentionSizeGb ?? existing.retentionSizeGb,
        storageId: nextStorageId,
        databasesToInclude: nextIncluded,
      };
      try {
        // upsertJobScheduler re-keys by id: changes cron/timezone in place, and is safe when only retention changed.
        await addBackupSchedule(databaseBackupQueue, existing.id, next.cron, next.timezone);
      } catch (err) {
        set.status = 400;
        return { error: `agendamento inválido: ${err instanceof Error ? err.message : "cron ou timezone"}` };
      }
      const [schedule] = await db.update(backupSchedules).set(next).where(eq(backupSchedules.id, existing.id)).returning();
      return { schedule: toScheduleDto(schedule as BackupSchedule) };
    },
    {
      body: t.Object({
        cron: t.Optional(t.String({ minLength: 1 })),
        timezone: t.Optional(t.String()),
        timeoutSeconds: t.Optional(t.Number()),
        retentionCount: t.Optional(t.Number()),
        retentionDays: t.Optional(t.Number()),
        retentionSizeGb: t.Optional(t.Number()),
        storageId: t.Optional(t.Nullable(t.String())),
        databases: t.Optional(t.Nullable(t.String({ maxLength: 1000 }))),
      }),
    },
  )
  // ?withBackups=true also deletes every backup file (local and S3) of the schedule.
  .delete("/:databaseId/backup-schedule/:scheduleId", async ({ ctx, params, query, set }) => {
    if ("error" in ctx) {
      set.status = ctx.status;
      return { error: ctx.error };
    }
    const [schedule] = await db.select().from(backupSchedules).where(and(eq(backupSchedules.id, params.scheduleId), eq(backupSchedules.databaseId, params.databaseId))).limit(1);
    if (!schedule) {
      set.status = 404;
      return { error: "backup schedule not found" };
    }
    let removedFiles = 0;
    if (query.withBackups === "true") {
      const executions = await db.select().from(backupExecutions).where(eq(backupExecutions.scheduleId, schedule.id));
      for (const execution of executions) {
        await deleteBackupFile(execution, ctx.database);
        removedFiles++;
      }
    }
    await removeBackupSchedule(databaseBackupQueue, schedule.id);
    // Cascades to the execution rows.
    await db.delete(backupSchedules).where(eq(backupSchedules.id, schedule.id));
    return { ok: true, removedFiles };
  })
  .post("/:databaseId/backup-schedule/:scheduleId/run-now", async ({ ctx, params, set }) => {
    if ("error" in ctx) {
      set.status = ctx.status;
      return { error: ctx.error };
    }
    const [schedule] = await db.select().from(backupSchedules).where(and(eq(backupSchedules.id, params.scheduleId), eq(backupSchedules.databaseId, params.databaseId))).limit(1);
    if (!schedule) {
      set.status = 404;
      return { error: "backup schedule not found" };
    }
    await databaseBackupQueue.add("backup", { scheduleId: schedule.id, manual: true });
    return { queued: true };
  })
  .get("/:databaseId/backup-executions", async ({ ctx, params, set }) => {
    if ("error" in ctx) {
      set.status = ctx.status;
      return { error: ctx.error };
    }
    const [schedule] = await db.select().from(backupSchedules).where(eq(backupSchedules.databaseId, params.databaseId)).limit(1);
    if (!schedule) return { executions: [] };
    const rows = await db.select().from(backupExecutions).where(eq(backupExecutions.scheduleId, schedule.id)).orderBy(desc(backupExecutions.createdAt)).limit(50);
    return { executions: rows.map(toExecutionDto) };
  })
  // Maintenance: drop failed runs, or runs whose file no longer exists on the server / in S3.
  .post(
    "/:databaseId/backup-executions/cleanup",
    async ({ ctx, params, body, set }) => {
      if ("error" in ctx) {
        set.status = ctx.status;
        return { error: ctx.error };
      }
      const [schedule] = await db.select().from(backupSchedules).where(eq(backupSchedules.databaseId, params.databaseId)).limit(1);
      if (!schedule) return { removed: 0 };
      const executions = await db.select().from(backupExecutions).where(eq(backupExecutions.scheduleId, schedule.id));

      let doomed: BackupExecution[];
      if (body.what === "failed") {
        doomed = executions.filter((e) => e.status === "failed");
      } else {
        // "missing": successful backups whose file is gone.
        const successful = executions.filter((e) => e.status === "success" && e.filePath);
        doomed = [];
        const local = successful.filter((e) => !e.s3StorageId);
        if (local.length > 0) {
          const conn = await sshTo(ctx.database.serverId).catch(() => null);
          if (!conn) {
            set.status = 502;
            return { error: "não consegui conectar no servidor pra conferir os arquivos" };
          }
          try {
            for (const e of local) {
              const result = await execStream(conn, `test -f ${shellQuote(e.filePath!)}`, () => undefined);
              if (result.exitCode !== 0) doomed.push(e);
            }
          } finally {
            conn.end();
          }
        }
        for (const e of successful.filter((x) => x.s3StorageId)) {
          const [storage] = await db.select().from(s3Storages).where(eq(s3Storages.id, e.s3StorageId!)).limit(1);
          if (!storage) {
            doomed.push(e);
            continue;
          }
          try {
            if (!(await s3ClientFor(storage).exists(e.filePath!))) doomed.push(e);
          } catch {
            // an unreachable bucket says nothing about the object — keep the row
          }
        }
      }
      if (doomed.length > 0) {
        if (body.what === "failed") for (const e of doomed) await deleteBackupFile(e, ctx.database).catch(() => undefined);
        await db.delete(backupExecutions).where(inArray(backupExecutions.id, doomed.map((e) => e.id)));
      }
      return { removed: doomed.length };
    },
    { body: t.Object({ what: t.Union([t.Literal("failed"), t.Literal("missing")]) }) },
  )
  .get("/:databaseId/backup-executions/:executionId/download", async ({ ctx, params, set }) => {
    if ("error" in ctx) {
      set.status = ctx.status;
      return { error: ctx.error };
    }
    const execution = await findExecution(params.databaseId, params.executionId);
    if (!execution || !execution.filePath) {
      set.status = 404;
      return { error: "backup file not found" };
    }
    if (execution.s3StorageId) {
      const [storage] = await db.select().from(s3Storages).where(eq(s3Storages.id, execution.s3StorageId)).limit(1);
      if (!storage) {
        set.status = 404;
        return { error: "storage not found" };
      }
      return Response.redirect(s3ClientFor(storage).presign(execution.filePath, { expiresIn: 300 }), 302);
    }
    // Deliberate exception to "the API never SSHes directly" (see servers.ts): a bounded SFTP read for a
    // download the browser is actively waiting on.
    const conn = await sshTo(ctx.database.serverId);
    if (!conn) {
      set.status = 404;
      return { error: "server not found" };
    }
    try {
      const fileBuffer = await readRemoteFile(conn, execution.filePath);
      const fileName = execution.filePath.split("/").pop() ?? "backup.sql.gz";
      return new Response(new Uint8Array(fileBuffer), { headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${fileName}"` } });
    } finally {
      conn.end();
    }
  })
  .delete("/:databaseId/backup-executions/:executionId", async ({ ctx, params, set }) => {
    if ("error" in ctx) {
      set.status = ctx.status;
      return { error: ctx.error };
    }
    const execution = await findExecution(params.databaseId, params.executionId);
    if (!execution) {
      set.status = 404;
      return { error: "backup not found" };
    }
    await deleteBackupFile(execution, ctx.database);
    await db.delete(backupExecutions).where(eq(backupExecutions.id, execution.id));
    return { ok: true };
  })
  // ---- restore
  .get("/:databaseId/restores", async ({ ctx, params, set }) => {
    if ("error" in ctx) {
      set.status = ctx.status;
      return { error: ctx.error };
    }
    const rows = await db.select().from(databaseRestores).where(eq(databaseRestores.databaseId, params.databaseId)).orderBy(desc(databaseRestores.createdAt)).limit(20);
    return { restores: rows.map(toRestoreDto) };
  })
  .post("/:databaseId/backup-executions/:executionId/restore", async ({ ctx, params, set }) => {
    if ("error" in ctx) {
      set.status = ctx.status;
      return { error: ctx.error };
    }
    const blocked = await restoreBlocked(ctx.database);
    if (blocked) {
      set.status = 409;
      return { error: blocked };
    }
    const execution = await findExecution(params.databaseId, params.executionId);
    if (!execution || execution.status !== "success" || !execution.filePath) {
      set.status = 404;
      return { error: "backup não encontrado (ou não terminou com sucesso)" };
    }
    const label = `backup de ${(execution.finishedAt ?? execution.createdAt).toISOString().replace("T", " ").slice(0, 16)} (${execution.filePath.split("/").pop()})`;
    const [restore] = await db.insert(databaseRestores).values({ databaseId: params.databaseId, sourceLabel: label }).returning();
    await databaseRestoreQueue.add("restore", { restoreId: restore!.id, source: { kind: "execution", executionId: execution.id } });
    return { restore: toRestoreDto(restore!) };
  })
  // Import from a file: the bytes are the raw request body, the file name is in ?name=.
  .post("/:databaseId/restore-upload", async ({ ctx, params, query, request, set }) => {
    if ("error" in ctx) {
      set.status = ctx.status;
      return { error: ctx.error };
    }
    const blocked = await restoreBlocked(ctx.database);
    if (blocked) {
      set.status = 409;
      return { error: blocked };
    }
    const name = (query.name ?? "").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
    if (!name) {
      set.status = 400;
      return { error: "informe o nome do arquivo (?name=)" };
    }
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > MAX_UPLOAD_BYTES) {
      set.status = 413;
      return { error: `arquivo grande demais pra enviar pelo painel (máximo ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)} MB) — coloque-o no S3 e restaure a partir de lá` };
    }
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_UPLOAD_BYTES) {
      set.status = bytes.length === 0 ? 400 : 413;
      return { error: bytes.length === 0 ? "arquivo vazio" : "arquivo grande demais" };
    }
    const path = `/opt/yeah-backups/${ctx.database.id}/import-${Date.now()}-${name}`;
    const conn = await sshTo(ctx.database.serverId);
    if (!conn) {
      set.status = 404;
      return { error: "server not found" };
    }
    try {
      await execStream(conn, `mkdir -p ${shellQuote(`/opt/yeah-backups/${ctx.database.id}`)}`, () => undefined);
      await writeRemoteFile(conn, path, bytes);
    } catch (err) {
      set.status = 502;
      return { error: `falha ao enviar o arquivo pro servidor: ${err instanceof Error ? err.message : "erro"}` };
    } finally {
      conn.end();
    }
    const [restore] = await db.insert(databaseRestores).values({ databaseId: params.databaseId, sourceLabel: `arquivo enviado: ${name}` }).returning();
    await databaseRestoreQueue.add("restore", { restoreId: restore!.id, source: { kind: "upload", path } });
    return { restore: toRestoreDto(restore!) };
  });

/** An execution, only if it belongs to this database. */
async function findExecution(databaseId: string, executionId: string): Promise<BackupExecution | null> {
  const [row] = await db
    .select({ execution: backupExecutions })
    .from(backupExecutions)
    .innerJoin(backupSchedules, eq(backupExecutions.scheduleId, backupSchedules.id))
    .where(and(eq(backupExecutions.id, executionId), eq(backupSchedules.databaseId, databaseId)))
    .limit(1);
  return row?.execution ?? null;
}

/** Why a restore cannot start right now, or null. */
async function restoreBlocked(database: Database): Promise<string | null> {
  if (database.status !== "running") return "o banco precisa estar rodando pra receber um restore";
  const running = await db.select({ id: databaseRestores.id }).from(databaseRestores).where(and(eq(databaseRestores.databaseId, database.id), inArray(databaseRestores.status, ["queued", "running"]))).limit(1);
  if (running[0]) return "já há um restore em andamento neste banco";
  return null;
}
