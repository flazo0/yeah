import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { applications } from "./applications";

export const deploymentStatusEnum = pgEnum("deployment_status", ["queued", "running", "success", "failed"]);

export const deployments = pgTable("deployments", {
  id: uuid("id").defaultRandom().primaryKey(),
  applicationId: uuid("application_id")
    .references(() => applications.id, { onDelete: "cascade" })
    .notNull(),
  status: deploymentStatusEnum("status").default("queued").notNull(),
  log: text("log").default("").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Deployment = typeof deployments.$inferSelect;
export type NewDeployment = typeof deployments.$inferInsert;
