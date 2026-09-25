import { bigint, boolean, integer, pgEnum, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { databases } from "./databases";
import { s3Storages } from "./storages";

export const backupScheduleStatusEnum = pgEnum("backup_execution_status", ["queued", "running", "success", "failed"]);

export const backupSchedules = pgTable("backup_schedules", {
  id: uuid("id").defaultRandom().primaryKey(),
  databaseId: uuid("database_id")
    .references(() => databases.id, { onDelete: "cascade" })
    .notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  // Standard 5-field cron expression, e.g. "0 0 * * *" for daily at midnight.
  cron: varchar("cron", { length: 100 }).notNull(),
  timezone: varchar("timezone", { length: 100 }).default("UTC").notNull(),
  timeoutSeconds: integer("timeout_seconds").default(3600).notNull(),
  // 0 in any of these means "no limit" for that rule — whichever limit is hit first wins.
  retentionCount: integer("retention_count").default(7).notNull(),
  retentionDays: integer("retention_days").default(0).notNull(),
  retentionSizeGb: integer("retention_size_gb").default(0).notNull(),
  // null = keep the dump on the target server's disk (original behavior); set = upload to that S3 destination instead.
  storageId: uuid("storage_id").references(() => s3Storages.id, { onDelete: "set null" }),
  // Comma-separated databases to dump from a multi-database instance; null = only the one it was created with.
  databasesToInclude: varchar("databases_to_include", { length: 1000 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const backupExecutions = pgTable("backup_executions", {
  id: uuid("id").defaultRandom().primaryKey(),
  scheduleId: uuid("schedule_id")
    .references(() => backupSchedules.id, { onDelete: "cascade" })
    .notNull(),
  status: backupScheduleStatusEnum("status").default("queued").notNull(),
  log: text("log").default("").notNull(),
  // Local mode: absolute path on the target server. S3 mode: the object key (s3StorageId is set).
  filePath: varchar("file_path", { length: 1024 }),
  s3StorageId: uuid("s3_storage_id").references(() => s3Storages.id, { onDelete: "set null" }),
  sizeBytes: bigint("size_bytes", { mode: "number" }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type BackupSchedule = typeof backupSchedules.$inferSelect;
export type NewBackupSchedule = typeof backupSchedules.$inferInsert;
export type BackupExecution = typeof backupExecutions.$inferSelect;
export type NewBackupExecution = typeof backupExecutions.$inferInsert;

// A restore of a database from a backup (or an uploaded file): its own history, because it replaces
// data and the operator needs the log of what happened.
export const databaseRestores = pgTable("database_restores", {
  id: uuid("id").defaultRandom().primaryKey(),
  databaseId: uuid("database_id")
    .references(() => databases.id, { onDelete: "cascade" })
    .notNull(),
  status: backupScheduleStatusEnum("status").default("queued").notNull(),
  // "backup de 24/09 14:03" or the uploaded file's name.
  sourceLabel: varchar("source_label", { length: 512 }).notNull(),
  log: text("log").default("").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type DatabaseRestore = typeof databaseRestores.$inferSelect;
