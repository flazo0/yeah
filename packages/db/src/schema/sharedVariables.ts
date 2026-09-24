import { pgEnum, pgTable, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { encryptedText } from "../encryption";
import { teams } from "./teams";
import { environments, projects } from "./projects";

export const sharedVariableScopeEnum = pgEnum("shared_variable_scope", ["team", "project", "environment"]);

// A variable declared once and referenced from any application's .env as {{scope.NAME}} (see
// packages/shared/src/env.ts). team-scope rows have neither project nor environment; project-scope rows
// have a project; environment-scope rows have an environment. The value is encrypted at rest.
export const sharedVariables = pgTable(
  "shared_variables",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    teamId: uuid("team_id")
      .references(() => teams.id, { onDelete: "cascade" })
      .notNull(),
    scope: sharedVariableScopeEnum("scope").notNull(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    environmentId: uuid("environment_id").references(() => environments.id, { onDelete: "cascade" }),
    key: varchar("key", { length: 255 }).notNull(),
    value: encryptedText("value").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [unique("shared_variables_unique_key").on(table.teamId, table.scope, table.projectId, table.environmentId, table.key).nullsNotDistinct()],
);

export type SharedVariable = typeof sharedVariables.$inferSelect;
