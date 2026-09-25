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
  resourceTags,
} from "@yeah/db";
import { DATABASE_ENGINES, databaseConnectionUrl, internalHostName, isValidDockerImage, type BackupExecutionDto, type BackupScheduleDto, type DatabaseDto } from "@yeah/shared";
import { addBackupSchedule, removeBackupSchedule } from "@yeah/queue";
import { connectSsh, execStream, readRemoteFile, shellQuote } from "@yeah/ssh";
import { s3ClientFor } from "@yeah/storage";
import { requireEnvironmentScope } from "../lib/scope";
import { db } from "../lib/db";
import { getUserFromSessionId, SESSION_COOKIE } from "../lib/session";
import { assertMember } from "../lib/access";
import { overloadReason } from "../lib/serverLoad";
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
    publicAccess: database.publicAccess,
    ssl: database.ssl,
    internalHost: internalHostName(database.name),
    healthEnabled: database.healthEnabled,
    healthIntervalSeconds: database.healthIntervalSeconds,
    healthTimeoutSeconds: database.healthTimeoutSeconds,
    healthRetries: database.healthRetries,
    memoryLimitMb: database.memoryLimitMb,
    cpuLimit: database.cpuLimit,
    status: database.status,
    createdAt: database.createdAt.toISOString(),
  };
}

export function toScheduleDto(schedule: BackupSchedule): BackupScheduleDto {
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
    databases: schedule.databasesToInclude,
    createdAt: schedule.createdAt.toISOString(),
  };
}

export function toExecutionDto(execution: BackupExecution): BackupExecutionDto {
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
export async function isValidStorageForTeam(teamId: string, storageId: string | null | undefined): Promise<boolean> {
  if (!storageId) return true;
  const rows = await db
    .select({ id: s3Storages.id })
    .from(s3Storages)
    .where(and(eq(s3Storages.id, storageId), eq(s3Storages.teamId, teamId)))
    .limit(1);
  return Boolean(rows[0]);
}

export async function loadDatabase(environmentId: string, databaseId: string) {
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
  .onBeforeHandle(requireEnvironmentScope)
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
    async ({ cookie, params, body, query, set }) => {
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
      const overload = overloadReason(server);
      if (overload && query.force !== "true") {
        set.status = 409;
        return { error: overload, code: "server_overloaded" };
      }

      const engine = body.engine ?? "postgresql";
      const engineInfo = DATABASE_ENGINES[engine];
      // The version is the image tag: "16-alpine" -> postgres:16-alpine. A full image reference also works.
      const image = body.image ?? (body.version ? `${engineInfo.imageRepo}:${body.version}` : engineInfo.defaultImage);
      if (!isValidDockerImage(image)) {
        set.status = 400;
        return { error: "versão/imagem inválida (ex.: 16-alpine ou postgres:16-alpine)" };
      }
      if (body.port !== undefined && (!Number.isInteger(body.port) || body.port < 1 || body.port > 65535)) {
        set.status = 400;
        return { error: "porta inválida" };
      }

      const [database] = await db
        .insert(databases)
        .values({
          teamId: params.teamId,
          environmentId: params.environmentId,
          serverId: body.serverId,
          name: body.name,
          engine,
          image,
          port: body.port ?? engineInfo.defaultPort,
          publicAccess: body.publicAccess ?? false,
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
            t.Literal("keydb"),
            t.Literal("dragonfly"),
            t.Literal("mongodb"),
            t.Literal("clickhouse"),
          ]),
        ),
        image: t.Optional(t.String()),
        version: t.Optional(t.String({ maxLength: 100 })),
        publicAccess: t.Optional(t.Boolean()),
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
    "/:databaseId/settings",
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
      const current = row.database;
      const info = DATABASE_ENGINES[current.engine];
      const next = {
        image: body.image ?? current.image,
        publicAccess: body.publicAccess ?? current.publicAccess,
        port: body.port ?? current.port,
        ssl: body.ssl ?? current.ssl,
        healthEnabled: body.healthEnabled ?? current.healthEnabled,
        healthIntervalSeconds: body.healthIntervalSeconds ?? current.healthIntervalSeconds,
        healthTimeoutSeconds: body.healthTimeoutSeconds ?? current.healthTimeoutSeconds,
        healthRetries: body.healthRetries ?? current.healthRetries,
      };
      if (!isValidDockerImage(next.image)) {
        set.status = 400;
        return { error: "imagem inválida" };
      }
      if (!Number.isInteger(next.port) || next.port < 1 || next.port > 65535) {
        set.status = 400;
        return { error: "porta inválida" };
      }
      if (next.ssl && !info.supportsSsl) {
        set.status = 400;
        return { error: `${info.label} ainda não tem TLS pelo painel` };
      }
      const ranges: Array<[string, number, number, number]> = [
        ["intervalo do healthcheck", next.healthIntervalSeconds, 5, 3600],
        ["timeout do healthcheck", next.healthTimeoutSeconds, 1, 300],
        ["tentativas do healthcheck", next.healthRetries, 1, 20],
      ];
      for (const [label, value, min, max] of ranges) {
        if (!Number.isInteger(value) || value < min || value > max) {
          set.status = 400;
          return { error: `${label} precisa ser um inteiro entre ${min} e ${max}` };
        }
      }
      if (next.publicAccess && next.port !== current.port || next.publicAccess) {
        // A port already published by another database of this server would make docker refuse to start it.
        const clash = await db
          .select({ name: databases.name })
          .from(databases)
          .where(and(eq(databases.serverId, current.serverId), eq(databases.publicAccess, true), eq(databases.port, next.port)));
        const other = clash.find((c) => c.name !== current.name);
        if (other) {
          set.status = 409;
          return { error: `a porta ${next.port} já está publicada pelo banco "${other.name}" neste servidor — escolha outra` };
        }
      }

      // Everything here takes effect when the container is recreated; the data volume is kept.
      const [updated] = await db.update(databases).set({ ...next, status: "provisioning" }).where(eq(databases.id, current.id)).returning();
      await databaseProvisionQueue.add("provision", { databaseId: current.id });
      return { database: toDatabaseDto(updated ?? current, row.serverName) };
    },
    {
      body: t.Object({
        image: t.Optional(t.String({ maxLength: 255 })),
        publicAccess: t.Optional(t.Boolean()),
        port: t.Optional(t.Number()),
        ssl: t.Optional(t.Boolean()),
        healthEnabled: t.Optional(t.Boolean()),
        healthIntervalSeconds: t.Optional(t.Number()),
        healthTimeoutSeconds: t.Optional(t.Number()),
        healthRetries: t.Optional(t.Number()),
      }),
    },
  )
  // Credentials on demand: the password is not part of the database DTO, only of this explicit read.
  .get("/:databaseId/connection", async ({ cookie, params, set }) => {
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
    const d = row.database;
    const [server] = await db.select().from(servers).where(eq(servers.id, d.serverId)).limit(1);
    const info = DATABASE_ENGINES[d.engine];
    const common = { engine: d.engine, username: d.username, password: d.password, databaseName: d.databaseName, ssl: d.ssl };
    return {
      username: d.username,
      password: d.password,
      internal: { host: internalHostName(d.name), port: info.internalPort, url: databaseConnectionUrl({ ...common, host: internalHostName(d.name), port: info.internalPort }) },
      external: d.publicAccess && server ? { host: server.host, port: d.port, url: databaseConnectionUrl({ ...common, host: server.host, port: d.port }) } : null,
    };
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
        timeoutMs: server.sshTimeoutSeconds * 1000,
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

    await db.delete(resourceTags).where(and(eq(resourceTags.resourceType, "database"), eq(resourceTags.resourceId, params.databaseId)));
    await db.delete(databases).where(eq(databases.id, params.databaseId));

    return { ok: true };
  });
