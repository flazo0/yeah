import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const platformOperationKindEnum = pgEnum("platform_operation_kind", ["platform_update", "system_update"]);
export const platformOperationStatusEnum = pgEnum("platform_operation_status", ["queued", "running", "success", "failed"]);

// Instance-wide, not team-scoped — there's exactly one platform (single-admin architecture), and
// these two operations (self-update yeah, apt upgrade the host) always target the one server
// flagged servers.isPlatformHost, never a per-team managed server.
export const platformOperations = pgTable("platform_operations", {
  id: uuid("id").defaultRandom().primaryKey(),
  kind: platformOperationKindEnum("kind").notNull(),
  status: platformOperationStatusEnum("status").default("queued").notNull(),
  log: text("log").default("").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type PlatformOperation = typeof platformOperations.$inferSelect;
export type NewPlatformOperation = typeof platformOperations.$inferInsert;
