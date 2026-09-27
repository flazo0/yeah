import { pgTable, text, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { servers } from "./servers";
import { backupScheduleStatusEnum } from "./backups";

// A CA certificate a server's Docker daemon should trust when pulling/pushing to a registry that
// serves a self-signed (or private-CA) TLS certificate — written to
// /etc/docker/certs.d/<host>/ca.crt by the worker (queued, like every other SSH mutation); Docker
// picks it up without a daemon restart. Not a secret (it's a certificate, not a key), so kept in the
// clear like dockerfileContent.
export const caCertificates = pgTable(
  "ca_certificates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    serverId: uuid("server_id")
      .references(() => servers.id, { onDelete: "cascade" })
      .notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    // Exactly what /etc/docker/certs.d/<this>/ca.crt matches against — "registry.example.com:5000".
    host: varchar("host", { length: 255 }).notNull(),
    pem: text("pem").notNull(),
    status: backupScheduleStatusEnum("status").default("queued").notNull(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [unique("ca_certificates_server_host_unique").on(table.serverId, table.host)],
);

export type CaCertificate = typeof caCertificates.$inferSelect;
export type NewCaCertificate = typeof caCertificates.$inferInsert;
