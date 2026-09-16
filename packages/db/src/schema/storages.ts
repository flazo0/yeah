import { pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { teams } from "./teams";

export const s3Storages = pgTable("s3_storages", {
  id: uuid("id").defaultRandom().primaryKey(),
  teamId: uuid("team_id")
    .references(() => teams.id, { onDelete: "cascade" })
    .notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  // Empty/default endpoint means "real AWS S3" (region-based); set for S3-compatible services (MinIO, R2, Spaces...).
  endpoint: varchar("endpoint", { length: 512 }),
  region: varchar("region", { length: 100 }).default("us-east-1").notNull(),
  bucket: varchar("bucket", { length: 255 }).notNull(),
  accessKeyId: varchar("access_key_id", { length: 255 }).notNull(),
  // TODO(security): same as servers.private_key — needs encryption at rest before production.
  secretAccessKey: varchar("secret_access_key", { length: 255 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type S3Storage = typeof s3Storages.$inferSelect;
export type NewS3Storage = typeof s3Storages.$inferInsert;
