import { bigint, boolean, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { servers } from "./servers";
import { backupScheduleStatusEnum } from "./backups";

// One optional cleanup schedule per server (`docker system prune`, by SSH) — at most one row per
// server_id, so the schedule lives keyed by the server itself rather than by its own id.
export const dockerCleanups = pgTable("docker_cleanups", {
  id: uuid("id").defaultRandom().primaryKey(),
  serverId: uuid("server_id")
    .references(() => servers.id, { onDelete: "cascade" })
    .notNull()
    .unique(),
  enabled: boolean("enabled").default(false).notNull(),
  // Standard 5-field cron expression, e.g. "0 4 * * 0" for Sundays at 4am.
  cron: varchar("cron", { length: 100 }).default("0 4 * * 0").notNull(),
  timezone: varchar("timezone", { length: 100 }).default("UTC").notNull(),
  // `docker system prune -f`, plus: -a (also unused images, not just dangling ones) and/or --volumes
  // (also unused anonymous *and named* volumes — can delete real data, opt-in only, off by default).
  pruneImages: boolean("prune_images").default(false).notNull(),
  pruneVolumes: boolean("prune_volumes").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const dockerCleanupExecutions = pgTable("docker_cleanup_executions", {
  id: uuid("id").defaultRandom().primaryKey(),
  serverId: uuid("server_id")
    .references(() => servers.id, { onDelete: "cascade" })
    .notNull(),
  status: backupScheduleStatusEnum("status").default("queued").notNull(),
  log: text("log").default("").notNull(),
  reclaimedBytes: bigint("reclaimed_bytes", { mode: "number" }),
  manual: boolean("manual").default(false).notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type DockerCleanup = typeof dockerCleanups.$inferSelect;
export type NewDockerCleanup = typeof dockerCleanups.$inferInsert;
export type DockerCleanupExecution = typeof dockerCleanupExecutions.$inferSelect;
