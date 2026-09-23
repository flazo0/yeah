import { integer, pgEnum, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { encryptedText } from "../encryption";
import { teams } from "./teams";
import { servers } from "./servers";
import { environments } from "./projects";
import { resourceLimitColumns } from "./columns";

// Only Dockerfile-based deploys are wired up today — compose/static/nixpacks/railpack
// come later, once the worker knows how to drive each of those builds too.
export const buildPackEnum = pgEnum("build_pack", ["dockerfile"]);
export const applicationStatusEnum = pgEnum("application_status", ["idle", "deploying", "running", "stopped", "error"]);

export const applications = pgTable("applications", {
  id: uuid("id").defaultRandom().primaryKey(),
  teamId: uuid("team_id")
    .references(() => teams.id, { onDelete: "cascade" })
    .notNull(),
  environmentId: uuid("environment_id")
    .references(() => environments.id, { onDelete: "cascade" })
    .notNull(),
  serverId: uuid("server_id")
    .references(() => servers.id, { onDelete: "cascade" })
    .notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  repoUrl: varchar("repo_url", { length: 1024 }).notNull(),
  branch: varchar("branch", { length: 255 }).default("main").notNull(),
  buildPack: buildPackEnum("build_pack").default("dockerfile").notNull(),
  port: integer("port").default(3000).notNull(),
  // Raw ".env" file contents — written to the server as-is before build/run.
  envContent: encryptedText("env_content").default("").notNull(),
  // null = no domain yet, container port is published directly on the host (original behavior).
  // Set = routed through the server's Traefik proxy instead, with automatic HTTPS.
  domain: varchar("domain", { length: 255 }),
  // Set when the repo was picked from a connected GitHub App installation instead of a manual
  // URL — the worker mints a fresh installation token per deploy and matches pushes for auto-deploy.
  githubInstallationId: integer("github_installation_id"),
  githubRepo: varchar("github_repo", { length: 255 }),
  // Docker healthcheck (run inside the container). null path = no healthcheck. When set, a deploy only
  // counts as successful once the container reports healthy.
  healthPath: varchar("health_path", { length: 255 }),
  healthIntervalSeconds: integer("health_interval_seconds").default(30).notNull(),
  healthTimeoutSeconds: integer("health_timeout_seconds").default(5).notNull(),
  healthRetries: integer("health_retries").default(3).notNull(),
  healthStartPeriodSeconds: integer("health_start_period_seconds").default(30).notNull(),
  // Extra flags appended to `docker run` (parsed into quoted words, never interpreted by a shell).
  dockerOptions: text("docker_options").default("").notNull(),
  // `docker stop -t` grace before the old container is removed on redeploy.
  stopGraceSeconds: integer("stop_grace_seconds").default(10).notNull(),
  // sha256 of the manual-deploy webhook token — the token itself is only shown once, when generated.
  deployTokenHash: varchar("deploy_token_hash", { length: 64 }).unique(),
  ...resourceLimitColumns(),
  status: applicationStatusEnum("status").default("idle").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Application = typeof applications.$inferSelect;
export type NewApplication = typeof applications.$inferInsert;
