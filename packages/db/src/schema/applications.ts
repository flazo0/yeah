import { integer, pgEnum, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { encryptedText } from "../encryption";
import { teams } from "./teams";
import { servers } from "./servers";
import { environments } from "./projects";
import { resourceLimitColumns } from "./columns";

// dockerfile / static / nixpacks build from a Git repo; image pulls a ready image; dockerfile_inline
// builds a Dockerfile pasted into the panel; docker_compose runs a compose file from the repo as one project.
// Railpack is not wired up yet.
export const buildPackEnum = pgEnum("build_pack", ["dockerfile", "static", "nixpacks", "image", "dockerfile_inline", "docker_compose"]);
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
  // image: the registry image to pull and run ("nginx:1.27-alpine").
  dockerImage: varchar("docker_image", { length: 512 }),
  // dockerfile_inline: the Dockerfile text itself.
  dockerfileContent: text("dockerfile_content"),
  // static: the folder (relative to the repo root) that gets served by nginx.
  publishDirectory: varchar("publish_directory", { length: 255 }).default(".").notNull(),
  composeFile: varchar("compose_file", { length: 255 }).default("docker-compose.yml").notNull(),
  composeService: varchar("compose_service", { length: 64 }),
  // Private repos over SSH: a per-application keypair. The private half is encrypted at rest; the
  // public half is shown to the user to register as a read-only deploy key on the repository.
  deployKey: encryptedText("deploy_key"),
  deployKeyPublic: text("deploy_key_public"),
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
