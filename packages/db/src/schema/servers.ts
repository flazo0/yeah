import { boolean, integer, pgEnum, pgTable, real, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { teams } from "./teams";
import { encryptedText } from "../encryption";

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
  // Encrypted at rest (AES-256-GCM, see ../encryption.ts) — reads/writes stay plaintext to callers.
  privateKey: encryptedText("private_key").notNull(),
  // Seconds to wait for the SSH handshake (slow or far-away hosts need more than the default).
  sshTimeoutSeconds: integer("ssh_timeout_seconds").default(15).notNull(),
  status: serverStatusEnum("status").default("pending").notNull(),
  dockerVersion: varchar("docker_version", { length: 100 }),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  // Wildcard base domain for this server, e.g. "apps.example.com" — an app with no
  // explicit domain gets "<app-slug>.apps.example.com" once the proxy is active.
  wildcardDomain: varchar("wildcard_domain", { length: 255 }),
  // Required by Let's Encrypt to register the ACME account that issues certs on this server.
  acmeEmail: varchar("acme_email", { length: 255 }),
  proxyStatus: proxyStatusEnum("proxy_status").default("inactive").notNull(),
  // Latest snapshot from the periodic `server-metrics` job — null until the first check runs.
  cpuPercent: real("cpu_percent"),
  memPercent: real("mem_percent"),
  diskPercent: real("disk_percent"),
  metricsCheckedAt: timestamp("metrics_checked_at", { withTimezone: true }),
  // Set only on the one server install.sh auto-registers (the machine yeah itself runs on) — the
  // Updates page's "atualizar plataforma"/"atualizar sistema" buttons target this row specifically,
  // never an arbitrary managed server, so there's no ambiguity about which host gets touched.
  isPlatformHost: boolean("is_platform_host").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Server = typeof servers.$inferSelect;
export type NewServer = typeof servers.$inferInsert;
