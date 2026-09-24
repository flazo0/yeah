import { boolean, integer, pgEnum, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { applications } from "./applications";

export const taskExecutionStatusEnum = pgEnum("task_execution_status", ["running", "success", "failed"]);

// A command run inside an application's container on a cron schedule (`docker exec <container> sh -c ...`).
export const scheduledTasks = pgTable("scheduled_tasks", {
  id: uuid("id").defaultRandom().primaryKey(),
  applicationId: uuid("application_id")
    .references(() => applications.id, { onDelete: "cascade" })
    .notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  command: text("command").notNull(),
  // Standard 5-field cron expression, same as backup schedules.
  cron: varchar("cron", { length: 100 }).notNull(),
  timezone: varchar("timezone", { length: 100 }).default("UTC").notNull(),
  timeoutSeconds: integer("timeout_seconds").default(300).notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const scheduledTaskExecutions = pgTable("scheduled_task_executions", {
  id: uuid("id").defaultRandom().primaryKey(),
  taskId: uuid("task_id")
    .references(() => scheduledTasks.id, { onDelete: "cascade" })
    .notNull(),
  status: taskExecutionStatusEnum("status").default("running").notNull(),
  log: text("log").default("").notNull(),
  exitCode: integer("exit_code"),
  // true when started by "Run now" instead of the cron.
  manual: boolean("manual").default(false).notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export type ScheduledTask = typeof scheduledTasks.$inferSelect;
export type ScheduledTaskExecution = typeof scheduledTaskExecutions.$inferSelect;
