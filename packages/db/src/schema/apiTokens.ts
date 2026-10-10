import { pgEnum, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { teams } from "./teams";
import { users } from "./users";

// Personal API tokens (Fase 7) — scoped to one team, with a permission level instead of full
// per-route ACLs (this app is single-admin per instance; "scope" here means team + read-vs-write, not
// per-resource grants). Only a sha256 hash is stored, same scheme as application deploy tokens
// (packages/.../deployRules.ts) — the raw token is shown once at creation and never again.
export const apiTokenPermissionEnum = pgEnum("api_token_permission", ["read", "full"]);

export const apiTokens = pgTable("api_tokens", {
  id: uuid("id").defaultRandom().primaryKey(),
  teamId: uuid("team_id")
    .references(() => teams.id, { onDelete: "cascade" })
    .notNull(),
  createdByUserId: uuid("created_by_user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  // First few characters of the raw token, kept in the clear so the list screen can help identify
  // which token is which without ever showing the whole thing again.
  tokenPrefix: varchar("token_prefix", { length: 12 }).notNull(),
  permission: apiTokenPermissionEnum("permission").default("read").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  // Set once an expiry-warning notification has gone out, so the daily check never sends it twice.
  expiryWarningSentAt: timestamp("expiry_warning_sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type ApiToken = typeof apiTokens.$inferSelect;
export type NewApiToken = typeof apiTokens.$inferInsert;
