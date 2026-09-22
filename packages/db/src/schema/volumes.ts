import { pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { applications } from "./applications";

// Custom named-volume mounts for Applications — Database/Service already get an implicit data
// volume (engine-fixed path for databases, catalog-defined path for services), so this is only
// for Dockerfile apps that need to persist something (uploads dir, SQLite file, etc.) across
// redeploys. The actual docker volume name is derived from this row's id — see volumeFlags() in
// @yeah/shared — never stored here, so there's one source of truth.
export const applicationVolumes = pgTable("application_volumes", {
  id: uuid("id").defaultRandom().primaryKey(),
  applicationId: uuid("application_id")
    .references(() => applications.id, { onDelete: "cascade" })
    .notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  mountPath: varchar("mount_path", { length: 512 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type ApplicationVolume = typeof applicationVolumes.$inferSelect;
export type NewApplicationVolume = typeof applicationVolumes.$inferInsert;
