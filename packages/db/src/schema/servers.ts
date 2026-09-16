import { integer, pgEnum, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { teams } from "./teams";

export const serverStatusEnum = pgEnum("server_status", ["pending", "connected", "error"]);
export const proxyStatusEnum = pgEnum("proxy_status", ["inactive", "provisioning", "active", "error"]);

export const servers = pgTable("servers", {
  id: uuid("id").defaultRandom().primaryKey(),
  teamId: uuid("team_id")
    .references(() => teams.id, { onDelete: "cascade" })
    .notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  host: varchar("host", { length: 255 }).notNull(),
  port: integer("port").default(22).notNull(),
  sshUser: varchar("ssh_user", { length: 100 }).default("root").notNull(),
  // TODO(security): encrypt at rest (libsodium sealed box / KMS) before any production deploy.
  privateKey: varchar("private_key", { length: 8192 }).notNull(),
  status: serverStatusEnum("status").default("pending").notNull(),
  dockerVersion: varchar("docker_version", { length: 100 }),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  // Wildcard base domain for this server, e.g. "apps.example.com" — an app with no
  // explicit domain gets "<app-slug>.apps.example.com" once the proxy is active.
  wildcardDomain: varchar("wildcard_domain", { length: 255 }),
  // Required by Let's Encrypt to register the ACME account that issues certs on this server.
  acmeEmail: varchar("acme_email", { length: 255 }),
  proxyStatus: proxyStatusEnum("proxy_status").default("inactive").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Server = typeof servers.$inferSelect;
export type NewServer = typeof servers.$inferInsert;
