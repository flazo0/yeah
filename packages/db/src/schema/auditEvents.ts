import { index, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { teams } from "./teams";
import { users } from "./users";

// Who changed what. Written for every successful mutating API call (never the request body — it may
// carry secrets); resource names are resolved when listing, so a rename or delete never rewrites history.
export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    teamId: uuid("team_id")
      .references(() => teams.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    // "token de API" when the call came in through a bearer token instead of a session.
    actor: varchar("actor", { length: 255 }),
    action: varchar("action", { length: 255 }).notNull(),
    level: varchar("level", { length: 16 }).default("info").notNull(),
    resourceType: varchar("resource_type", { length: 32 }).notNull(),
    resourceId: uuid("resource_id"),
    // Ids found in the path (project/application/service/database/server) so names can be looked up later.
    refs: varchar("refs", { length: 2000 }),
    method: varchar("method", { length: 8 }).notNull(),
    path: varchar("path", { length: 512 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("audit_events_team_created_idx").on(table.teamId, table.createdAt)],
);

export type AuditEvent = typeof auditEvents.$inferSelect;
