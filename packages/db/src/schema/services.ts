import { integer, pgEnum, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { teams } from "./teams";
import { servers } from "./servers";
import { environments } from "./projects";

export const serviceStatusEnum = pgEnum("service_status", ["idle", "provisioning", "running", "error"]);

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
  envContent: text("env_content").default("").notNull(),
  domain: varchar("domain", { length: 255 }),
  status: serviceStatusEnum("status").default("idle").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Service = typeof services.$inferSelect;
export type NewService = typeof services.$inferInsert;
