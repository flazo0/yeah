import { boolean, integer, jsonb, pgEnum, pgTable, real, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { teams } from "./teams";
import { sshKeys } from "./sshKeys";
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
  // Set only when this server's key was copied in from Keys & Tokens (reused) — this is just
  // provenance for the UI ("chave X") and to refuse deleting a key that's still in use; the connection
  // itself always uses the copy in private_key above, never a live join to this row.
  sshKeyId: uuid("ssh_key_id").references(() => sshKeys.id, { onDelete: "set null" }),
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
  // A Cloudflare Tunnel into this server's own proxy (yeah-proxy) — an alternative/complement to a
  // public IP + Let's Encrypt for reaching whatever's deployed here. The token is the one thing
  // Cloudflare's dashboard gives you when creating the tunnel; which public hostnames it answers for
  // (wildcard or a single resource) is configured entirely on Cloudflare's side, not here.
  cloudflareTunnelToken: encryptedText("cloudflare_tunnel_token"),
  cloudflareTunnelStatus: proxyStatusEnum("cloudflare_tunnel_status").default("inactive").notNull(),
  cloudflareTunnelError: varchar("cloudflare_tunnel_error", { length: 1000 }),
  // Off by default (another "pay for it only if you want it" monitoring toggle, see metrics_enabled) —
  // turns on Traefik's Prometheus metrics entrypoint (loopback-only, never published publicly) so the
  // traffic-analytics job can read per-router request counts over SSH, the same ephemeral-connection
  // model as every other metric this app collects. Requires re-provisioning the proxy to take effect
  // (the port mapping can't change on a running container).
  trafficAnalyticsEnabled: boolean("traffic_analytics_enabled").default(false).notNull(),
  // Latest snapshot from the periodic `server-metrics` job — null until the first check runs.
  cpuPercent: real("cpu_percent"),
  memPercent: real("mem_percent"),
  diskPercent: real("disk_percent"),
  metricsCheckedAt: timestamp("metrics_checked_at", { withTimezone: true }),
  // Off switch for the periodic docker-stats-over-SSH poll (server + per-container history) — costs
  // one SSH connect/exec per tick plus DB writes, so whoever is optimizing for a minimal footprint
  // on a small VPS can disable it per server instead of all-or-nothing.
  metricsEnabled: boolean("metrics_enabled").default(true).notNull(),
  // Set only on the one server install.sh auto-registers (the machine yeah itself runs on) — the
  // Updates page's "atualizar plataforma"/"atualizar sistema" buttons target this row specifically,
  // never an arbitrary managed server, so there's no ambiguity about which host gets touched.
  isPlatformHost: boolean("is_platform_host").default(false).notNull(),
  // OS updates (apt) — snapshot from the periodic/on-demand patch check; null until the first run.
  patchCheckedAt: timestamp("patch_checked_at", { withTimezone: true }),
  patchUpdates: integer("patch_updates"),
  patchSecurity: integer("patch_security"),
  patchRebootRequired: boolean("patch_reboot_required").default(false).notNull(),
  patchPackages: jsonb("patch_packages").$type<Array<{ name: string; version: string; security: boolean; risky: boolean }>>(),
  // Highest security-update count already announced, so the same pending set is notified once.
  patchNotifiedSecurity: integer("patch_notified_security").default(0).notNull(),
  autoSecurityUpdates: boolean("auto_security_updates").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Server = typeof servers.$inferSelect;
export type NewServer = typeof servers.$inferInsert;
