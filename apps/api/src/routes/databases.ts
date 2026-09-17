import { Elysia, t } from "elysia";
import { and, desc, eq } from "drizzle-orm";
import {
  backupExecutions,
  backupSchedules,
  databases,
  s3Storages,
  servers,
  type BackupExecution,
  type BackupSchedule,
  type Database,
} from "@yeah/db";
import { DATABASE_ENGINES, type BackupExecutionDto, type BackupScheduleDto, type DatabaseDto } from "@yeah/shared";
import { addBackupSchedule, removeBackupSchedule } from "@yeah/queue";
import { connectSsh, execStream, readRemoteFile, shellQuote } from "@yeah/ssh";
import { s3ClientFor } from "@yeah/storage";
import { db } from "../lib/db";
import { getUserFromSessionId, SESSION_COOKIE } from "../lib/session";
import { assertMember } from "../lib/access";
import { loadEnvironment } from "../lib/projects";
import { databaseBackupQueue, databaseProvisionQueue } from "../lib/queue";

function toDatabaseDto(database: Database, serverName: string): DatabaseDto {
  return {
    id: database.id,
    teamId: database.teamId,
    environmentId: database.environmentId,
    serverId: database.serverId,
    serverName,
    name: database.name,
    engine: database.engine,
    image: database.image,
    port: database.port,
    username: database.username,
    databaseName: database.databaseName,
    memoryLimitMb: database.memoryLimitMb,
    cpuLimit: database.cpuLimit,
    status: database.status,
    createdAt: database.createdAt.toISOString(),
  };
}

function toScheduleDto(schedule: BackupSchedule): BackupScheduleDto {
  return {
    id: schedule.id,
    databaseId: schedule.databaseId,
    enabled: schedule.enabled,
    cron: schedule.cron,
    timezone: schedule.timezone,
    timeoutSeconds: schedule.timeoutSeconds,
    retentionCount: schedule.retentionCount,
    retentionDays: schedule.retentionDays,
    retentionSizeGb: schedule.retentionSizeGb,
    storageId: schedule.storageId,
    createdAt: schedule.createdAt.toISOString(),
  };
}

function toExecutionDto(execution: BackupExecution): BackupExecutionDto {
  return {
    id: execution.id,
    scheduleId: execution.scheduleId,
    status: execution.status,
    log: execution.log,
    filePath: execution.filePath,
    s3StorageId: execution.s3StorageId,
    sizeBytes: execution.sizeBytes,
    startedAt: execution.startedAt ? execution.startedAt.toISOString() : null,
    finishedAt: execution.finishedAt ? execution.finishedAt.toISOString() : null,
    createdAt: execution.createdAt.toISOString(),
  };
}

function generatePassword(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

function containerNameForDatabase(databaseId: string): string {
  return `yeah-db-${databaseId}`;
}

/** Returns false only when a storageId was given but doesn't belong to the team — null/undefined pass through as "local". */
async function isValidStorageForTeam(teamId: string, storageId: string | null | undefined): Promise<boolean> {
  if (!storageId) return true;
  const rows = await db
    .select({ id: s3Storages.id })
    .from(s3Storages)
    .where(and(eq(s3Storages.id, storageId), eq(s3Storages.teamId, teamId)))
    .limit(1);
  return Boolean(rows[0]);
}

async function loadDatabase(environmentId: string, databaseId: string) {
  const rows = await db
    .select({ database: databases, serverName: servers.name })
    .from(databases)
    .innerJoin(servers, eq(databases.serverId, servers.id))
    .where(and(eq(databases.id, databaseId), eq(databases.environmentId, environmentId)))
    .limit(1);
  return rows[0];
}

export const databaseRoutes = new Elysia({
  prefix: "/teams/:teamId/projects/:projectId/environments/:environmentId/databases",
})
  .get("/", async ({ cookie, params, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    if (!(await assertMember(params.teamId, user.id))) {
      set.status = 403;
      return { error: "forbidden" };
    }
    if (!(await loadEnvironment(params.teamId, params.projectId, params.environmentId))) {
      set.status = 404;
      return { error: "environment not found" };
    }

    const rows = await db
      .select({ database: databases, serverName: servers.name })
      .from(databases)
      .innerJoin(servers, eq(databases.serverId, servers.id))
      .where(eq(databases.environmentId, params.environmentId));

    return { databases: rows.map((row) => toDatabaseDto(row.database, row.serverName)) };
  })
  .post(
    "/",
    async ({ cookie, params, body, set }) => {
      const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
      if (!user) {
        set.status = 401;
        return { error: "unauthorized" };
      }
      if (!(await assertMember(params.teamId, user.id))) {
        set.status = 403;
        return { error: "forbidden" };
      }
      if (!(await loadEnvironment(params.teamId, params.projectId, params.environmentId))) {
        set.status = 404;
        return { error: "environment not found" };
      }

      const serverRows = await db
        .select()
        .from(servers)
        .where(and(eq(servers.id, body.serverId), eq(servers.teamId, params.teamId)))
        .limit(1);
      const server = serverRows[0];
      if (!server) {
        set.status = 404;
        return { error: "server not found" };
      }

      const engine = body.engine ?? "postgresql";
      const engineInfo = DATABASE_ENGINES[engine];

      const [database] = await db
        .insert(databases)
        .values({
          teamId: params.teamId,
          environmentId: params.environmentId,
          serverId: body.serverId,
          name: body.name,
          engine,
          image: body.image ?? engineInfo.defaultImage,
          port: body.port ?? engineInfo.defaultPort,
          username: engineInfo.hasUsername ? (body.username ?? "app") : null,
          password: generatePassword(),
          databaseName: engineInfo.hasDatabaseName ? (body.databaseName ?? "app") : null,
          memoryLimitMb: body.memoryLimitMb ?? null,
          cpuLimit: body.cpuLimit ?? null,
        })
        .returning();
      if (!database) {
        set.status = 500;
        return { error: "failed to create database" };
      }

      await databaseProvisionQueue.add("provision", { databaseId: database.id });

      return { database: toDatabaseDto(database, server.name) };
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        serverId: t.String({ minLength: 1 }),
        engine: t.Optional(
          t.Union([
            t.Literal("postgresql"),
            t.Literal("mysql"),
            t.Literal("mariadb"),
            t.Literal("redis"),
            t.Literal("mongodb"),
          ]),
        ),
        image: t.Optional(t.String()),
        port: t.Optional(t.Number()),
        username: t.Optional(t.String()),
        databaseName: t.Optional(t.String()),
        memoryLimitMb: t.Optional(t.Nullable(t.Number())),
        cpuLimit: t.Optional(t.Nullable(t.Number())),
      }),
    },
  )
  .get("/:databaseId", async ({ cookie, params, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    if (!(await assertMember(params.teamId, user.id))) {
      set.status = 403;
      return { error: "forbidden" };
    }

    const row = await loadDatabase(params.environmentId, params.databaseId);
    if (!row) {
      set.status = 404;
      return { error: "database not found" };
    }

    return { database: toDatabaseDto(row.database, row.serverName) };
  })
  .put(
    "/:databaseId/limits",
    async ({ cookie, params, body, set }) => {
      const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
      if (!user) {
        set.status = 401;
        return { error: "unauthorized" };
      }
      if (!(await assertMember(params.teamId, user.id))) {
        set.status = 403;
        return { error: "forbidden" };
      }

      const row = await loadDatabase(params.environmentId, params.databaseId);
      if (!row) {
        set.status = 404;
        return { error: "database not found" };
      }

      const [updated] = await db
        .update(databases)
        .set({ memoryLimitMb: body.memoryLimitMb ?? null, cpuLimit: body.cpuLimit ?? null, status: "provisioning" })
        .where(eq(databases.id, params.databaseId))
        .returning();
      if (!updated) {
        set.status = 500;
        return { error: "failed to update limits" };
      }

      // Limits only take effect on container recreation — the processor removes and re-runs
      // the container idempotently, so re-queueing here is safe and has no other side effects.
      await databaseProvisionQueue.add("provision", { databaseId: updated.id });

      return { database: toDatabaseDto(updated, row.serverName) };
    },
    { body: t.Object({ memoryLimitMb: t.Optional(t.Nullable(t.Number())), cpuLimit: t.Optional(t.Nullable(t.Number())) }) },
  )
  .get("/:databaseId/backup-schedule", async ({ cookie, params, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    if (!(await assertMember(params.teamId, user.id))) {
      set.status = 403;
      return { error: "forbidden" };
    }
    if (!(await loadDatabase(params.environmentId, params.databaseId))) {
      set.status = 404;
      return { error: "database not found" };
    }

    const rows = await db.select().from(backupSchedules).where(eq(backupSchedules.databaseId, params.databaseId)).limit(1);
    return { schedule: rows[0] ? toScheduleDto(rows[0]) : null };
  })
  .post(
    "/:databaseId/backup-schedule",
    async ({ cookie, params, body, set }) => {
      const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
      if (!user) {
        set.status = 401;
        return { error: "unauthorized" };
      }
      if (!(await assertMember(params.teamId, user.id))) {
        set.status = 403;
        return { error: "forbidden" };
      }
      if (!(await loadDatabase(params.environmentId, params.databaseId))) {
        set.status = 404;
        return { error: "database not found" };
      }

      const existing = await db
        .select()
        .from(backupSchedules)
        .where(eq(backupSchedules.databaseId, params.databaseId))
        .limit(1);
      if (existing[0]) {
        set.status = 409;
        return { error: "a backup schedule already exists — delete it before creating a new one" };
      }
      if (!(await isValidStorageForTeam(params.teamId, body.storageId))) {
        set.status = 404;
        return { error: "storage not found" };
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
        })
        .returning();
      if (!schedule) {
        set.status = 500;
        return { error: "failed to create backup schedule" };
      }

      await addBackupSchedule(databaseBackupQueue, schedule.id, schedule.cron, schedule.timezone);

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
      }),
    },
  )
  .put(
    "/:databaseId/backup-schedule/:scheduleId",
    async ({ cookie, params, body, set }) => {
      const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
      if (!user) {
        set.status = 401;
        return { error: "unauthorized" };
      }
      if (!(await assertMember(params.teamId, user.id))) {
        set.status = 403;
        return { error: "forbidden" };
      }
      if (!(await loadDatabase(params.environmentId, params.databaseId))) {
        set.status = 404;
        return { error: "database not found" };
      }

      const existing = await db
        .select()
        .from(backupSchedules)
        .where(and(eq(backupSchedules.id, params.scheduleId), eq(backupSchedules.databaseId, params.databaseId)))
        .limit(1);
      if (!existing[0]) {
        set.status = 404;
        return { error: "backup schedule not found" };
      }
      // Tri-state: absent = keep current storage, explicit null = switch to local, a string = switch S3 destination.
      const nextStorageId = "storageId" in body ? (body.storageId ?? null) : existing[0].storageId;
      if (!(await isValidStorageForTeam(params.teamId, nextStorageId))) {
        set.status = 404;
        return { error: "storage not found" };
      }

      const [schedule] = await db
        .update(backupSchedules)
        .set({
          cron: body.cron ?? existing[0].cron,
          timezone: body.timezone ?? existing[0].timezone,
          timeoutSeconds: body.timeoutSeconds ?? existing[0].timeoutSeconds,
          retentionCount: body.retentionCount ?? existing[0].retentionCount,
          retentionDays: body.retentionDays ?? existing[0].retentionDays,
          retentionSizeGb: body.retentionSizeGb ?? existing[0].retentionSizeGb,
          storageId: nextStorageId,
        })
        .where(eq(backupSchedules.id, params.scheduleId))
        .returning();
      if (!schedule) {
        set.status = 500;
        return { error: "failed to update backup schedule" };
      }

      // upsertJobScheduler re-keys by id, so this both changes the cron/timezone of the
      // existing scheduler and is safe to call even if only the retention rules changed.
      await addBackupSchedule(databaseBackupQueue, schedule.id, schedule.cron, schedule.timezone);

      return { schedule: toScheduleDto(schedule) };
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
      }),
    },
  )
  .delete("/:databaseId/backup-schedule/:scheduleId", async ({ cookie, params, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    if (!(await assertMember(params.teamId, user.id))) {
      set.status = 403;
      return { error: "forbidden" };
    }

    await removeBackupSchedule(databaseBackupQueue, params.scheduleId);
    await db
      .delete(backupSchedules)
      .where(and(eq(backupSchedules.id, params.scheduleId), eq(backupSchedules.databaseId, params.databaseId)));

    return { ok: true };
  })
  .post("/:databaseId/backup-schedule/:scheduleId/run-now", async ({ cookie, params, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    if (!(await assertMember(params.teamId, user.id))) {
      set.status = 403;
      return { error: "forbidden" };
    }

    await databaseBackupQueue.add("backup", { scheduleId: params.scheduleId, manual: true });
    return { queued: true };
  })
  .get("/:databaseId/backup-executions", async ({ cookie, params, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    if (!(await assertMember(params.teamId, user.id))) {
      set.status = 403;
      return { error: "forbidden" };
    }

    const scheduleRows = await db
      .select()
      .from(backupSchedules)
      .where(eq(backupSchedules.databaseId, params.databaseId))
      .limit(1);
    const schedule = scheduleRows[0];
    if (!schedule) return { executions: [] };

    const rows = await db
      .select()
      .from(backupExecutions)
      .where(eq(backupExecutions.scheduleId, schedule.id))
      .orderBy(desc(backupExecutions.createdAt))
      .limit(50);

    return { executions: rows.map(toExecutionDto) };
  })
  .get("/:databaseId/backup-executions/:executionId/download", async ({ cookie, params, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    if (!(await assertMember(params.teamId, user.id))) {
      set.status = 403;
      return { error: "forbidden" };
    }

    const row = await loadDatabase(params.environmentId, params.databaseId);
    if (!row) {
      set.status = 404;
      return { error: "database not found" };
    }

    const executionRows = await db
      .select()
      .from(backupExecutions)
      .where(eq(backupExecutions.id, params.executionId))
      .limit(1);
    const execution = executionRows[0];
    if (!execution || !execution.filePath) {
      set.status = 404;
      return { error: "backup file not found" };
    }

    if (execution.s3StorageId) {
      const storageRows = await db.select().from(s3Storages).where(eq(s3Storages.id, execution.s3StorageId)).limit(1);
      const storage = storageRows[0];
      if (!storage) {
        set.status = 404;
        return { error: "storage not found" };
      }
      const url = s3ClientFor(storage).presign(execution.filePath, { expiresIn: 300 });
      return Response.redirect(url, 302);
    }

    const serverRows = await db.select().from(servers).where(eq(servers.id, row.database.serverId)).limit(1);
    const server = serverRows[0];
    if (!server) {
      set.status = 404;
      return { error: "server not found" };
    }

    // Deliberate exception to "the API never SSHes directly" (see servers.ts): this is a bounded,
    // synchronous SFTP read for a download the browser is actively waiting on — routing it through
    // the worker would mean a job + polling endpoint just to fetch bytes we can stream back now.
    const sshConn = await connectSsh({
      host: server.host,
      port: server.port,
      username: server.sshUser,
      privateKey: server.privateKey,
    });
    try {
      const fileBuffer = await readRemoteFile(sshConn, execution.filePath);
      const fileName = execution.filePath.split("/").pop() ?? "backup.sql.gz";
      return new Response(new Uint8Array(fileBuffer), {
        headers: {
          "Content-Type": "application/gzip",
          "Content-Disposition": `attachment; filename="${fileName}"`,
        },
      });
    } finally {
      sshConn.end();
    }
  })
  .delete("/:databaseId/backup-executions/:executionId", async ({ cookie, params, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    if (!(await assertMember(params.teamId, user.id))) {
      set.status = 403;
      return { error: "forbidden" };
    }

    const executionRows = await db
      .select()
      .from(backupExecutions)
      .where(eq(backupExecutions.id, params.executionId))
      .limit(1);
    const execution = executionRows[0];

    if (execution?.s3StorageId && execution.filePath) {
      const storageRows = await db.select().from(s3Storages).where(eq(s3Storages.id, execution.s3StorageId)).limit(1);
      const storage = storageRows[0];
      if (storage) {
        try {
          await s3ClientFor(storage).delete(execution.filePath);
        } catch (err) {
          console.error(`[api] failed to delete S3 object for execution ${execution.id}:`, err);
        }
      }
    }

    await db.delete(backupExecutions).where(eq(backupExecutions.id, params.executionId));
    return { ok: true };
  })
  .delete("/:databaseId", async ({ cookie, params, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    if (!(await assertMember(params.teamId, user.id))) {
      set.status = 403;
      return { error: "forbidden" };
    }

    const row = await loadDatabase(params.environmentId, params.databaseId);
    if (!row) {
      set.status = 404;
      return { error: "database not found" };
    }

    // The BullMQ job scheduler lives in Redis, not Postgres — the cascade delete below won't
    // touch it, so an orphaned schedule would keep firing against a database that no longer exists.
    const scheduleRows = await db
      .select()
      .from(backupSchedules)
      .where(eq(backupSchedules.databaseId, params.databaseId))
      .limit(1);
    if (scheduleRows[0]) {
      await removeBackupSchedule(databaseBackupQueue, scheduleRows[0].id);
    }

    const serverRows = await db.select().from(servers).where(eq(servers.id, row.database.serverId)).limit(1);
    const server = serverRows[0];

    // Deliberate exception to "the API never SSHes directly" (see servers.ts): a bounded,
    // synchronous teardown the browser is waiting on — same rationale as the backup download route.
    if (server) {
      const containerName = containerNameForDatabase(row.database.id);
      const volumeName = `${containerName}-data`;
      const backupDir = `/opt/yeah-backups/${row.database.id}`;
      try {
        const conn = await connectSsh({
          host: server.host,
          port: server.port,
          username: server.sshUser,
          privateKey: server.privateKey,
        });
        try {
          await execStream(
            conn,
            `docker rm -f ${shellQuote(containerName)} >/dev/null 2>&1 || true && ` +
              `docker volume rm ${shellQuote(volumeName)} >/dev/null 2>&1 || true && ` +
              `rm -rf ${shellQuote(backupDir)} >/dev/null 2>&1 || true`,
            () => {},
          );
        } finally {
          conn.end();
        }
      } catch (err) {
        console.error(`[api] failed to tear down container for database ${row.database.id}:`, err);
      }
    }

    await db.delete(databases).where(eq(databases.id, params.databaseId));

    return { ok: true };
  });
