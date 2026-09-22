import { pgEnum, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { applications } from "./applications";

export const deploymentStatusEnum = pgEnum("deployment_status", ["queued", "running", "success", "failed"]);

export const deployments = pgTable("deployments", {
  id: uuid("id").defaultRandom().primaryKey(),
  applicationId: uuid("application_id")
    .references(() => applications.id, { onDelete: "cascade" })
    .notNull(),
  status: deploymentStatusEnum("status").default("queued").notNull(),
  log: text("log").default("").notNull(),
  // Set by the worker once the repo is checked out — the commit that actually got built and run.
  // Also doubles as the rollback *request* field: creating a rollback deployment pre-fills this
  // with a past deployment's commitSha, and the worker checks that out instead of the branch HEAD
  // (see resolveCheckoutRef in deployApplication.commands.ts) — one column, two directions, no
  // separate job-data plumbing needed for rollback.
  commitSha: varchar("commit_sha", { length: 40 }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Deployment = typeof deployments.$inferSelect;
export type NewDeployment = typeof deployments.$inferInsert;
