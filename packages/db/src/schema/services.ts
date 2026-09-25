import { integer, jsonb, pgEnum, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { encryptedText } from "../encryption";
import { teams } from "./teams";
import { servers } from "./servers";
import { environments } from "./projects";
import { resourceLimitColumns } from "./columns";

export const serviceStatusEnum = pgEnum("service_status", ["idle", "provisioning", "running", "stopped", "error"]);

export const services = pgTable("services", {
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
  // Key into the static catalog in packages/shared/src/serviceCatalog.ts — the image, port and
  // volume path all come from there; this column is what ties a running instance back to it.
  catalogKey: varchar("catalog_key", { length: 100 }).notNull(),
  image: varchar("image", { length: 255 }).notNull(),
  port: integer("port").notNull(),
  // Raw ".env" file contents, pre-filled from the catalog entry's template — same pattern as
  // Application.envContent, user-editable before/after provisioning.
  envContent: encryptedText("env_content").default("").notNull(),
  domain: varchar("domain", { length: 255 }),
  // Stack services (a template or a pasted compose file): the compose text and where it came from.
  // null compose = a legacy single-container service described by catalog_key.
  composeContent: text("compose_content"),
  templateKey: varchar("template_key", { length: 100 }),
  // The compose service that also answers to the plain name on the environment network.
  mainService: varchar("main_service", { length: 64 }),
  // Domains per container: [{ service, domain, port }].
  domains: jsonb("domains").$type<Array<{ service: string; domain: string; port: number }>>().default([]).notNull(),
  // Output of the last deploy of the stack, so a failure is readable in the panel.
  lastLog: text("last_log").default("").notNull(),
  ...resourceLimitColumns(),
  status: serviceStatusEnum("status").default("idle").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Service = typeof services.$inferSelect;
export type NewService = typeof services.$inferInsert;
