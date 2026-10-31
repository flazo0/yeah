import { boolean, integer, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { s3Storages } from "./storages";

// Settings of the whole installation (not of a team). There is one row, created the first time something is saved.
export const instanceSettings = pgTable("instance_settings", {
  id: uuid("id").defaultRandom().primaryKey(),
  // Hostname the panel itself is served on (HTTPS through the platform server's Traefik). null = not configured.
  panelDomain: varchar("panel_domain", { length: 255 }),
  // Scheduled backup of the panel's own database to S3 (see shared/instanceBackup.ts). Off by default.
  backupEnabled: boolean("backup_enabled").default(false).notNull(),
  backupStorageId: uuid("backup_storage_id").references(() => s3Storages.id, { onDelete: "set null" }),
  backupHourUtc: integer("backup_hour_utc").default(3).notNull(),
  backupRetention: integer("backup_retention").default(7).notNull(),
  backupLastAt: timestamp("backup_last_at", { withTimezone: true }),
  backupLastStatus: varchar("backup_last_status", { length: 16 }),
  backupLastError: varchar("backup_last_error", { length: 500 }),
  backupLastSizeBytes: integer("backup_last_size_bytes"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type InstanceSettings = typeof instanceSettings.$inferSelect;
