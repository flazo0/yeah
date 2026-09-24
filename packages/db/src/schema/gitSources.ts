import { pgEnum, pgTable, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { encryptedText } from "../encryption";
import { teams } from "./teams";

export const gitProviderEnum = pgEnum("git_provider", ["gitlab", "bitbucket", "gitea"]);

// A GitLab / Bitbucket Cloud / Gitea source: an access token (encrypted) used to list repositories and
// clone, and a per-source webhook secret (encrypted) that proves a push webhook came from the provider.
export const gitSources = pgTable(
  "git_sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    teamId: uuid("team_id")
      .references(() => teams.id, { onDelete: "cascade" })
      .notNull(),
    provider: gitProviderEnum("provider").notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    baseUrl: varchar("base_url", { length: 255 }).notNull(),
    username: varchar("username", { length: 255 }).default("").notNull(),
    token: encryptedText("token").notNull(),
    webhookSecret: encryptedText("webhook_secret").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [unique("git_sources_team_name_unique").on(table.teamId, table.name)],
);

export type GitSource = typeof gitSources.$inferSelect;
