import { bigint, pgEnum, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { teams } from "./teams";
import { backupScheduleStatusEnum } from "./backups";
import { s3Storages } from "./storages";

export const volumeBackupOwnerEnum = pgEnum("volume_backup_owner", ["application", "service"]);
export const volumeBackupOperationEnum = pgEnum("volume_backup_operation", ["backup", "restore"]);

// A tar.gz of a persistent volume of an application (or, later, a service), plus the history of restoring
// one. resource_id has no FK because it points at applications or services; deleting the resource clears
// its rows (and files) explicitly.
export const volumeBackups = pgTable("volume_backups", {
  id: uuid("id").defaultRandom().primaryKey(),
  teamId: uuid("team_id")
    .references(() => teams.id, { onDelete: "cascade" })
    .notNull(),
  ownerType: volumeBackupOwnerEnum("owner_type").notNull(),
  ownerId: uuid("owner_id").notNull(),
  // The volume row (applications) — "which of the app's volumes".
  volumeId: uuid("volume_id"),
  // Human label: the mount path, e.g. "/data".
  label: varchar("label", { length: 512 }).notNull(),
  operation: volumeBackupOperationEnum("operation").default("backup").notNull(),
  status: backupScheduleStatusEnum("status").default("queued").notNull(),
  log: text("log").default("").notNull(),
  // Set when the archive lives in S3: file_path is then the object key, not a path on the server.
  s3StorageId: uuid("s3_storage_id").references(() => s3Storages.id, { onDelete: "set null" }),
  // Absolute path of the archive on the server (or the S3 object key).
  filePath: varchar("file_path", { length: 1024 }),
  sizeBytes: bigint("size_bytes", { mode: "number" }),
  // For a restore: the backup that was restored.
  sourceBackupId: uuid("source_backup_id"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type VolumeBackup = typeof volumeBackups.$inferSelect;
