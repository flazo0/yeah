import { bigint, index, integer, pgEnum, pgTable, real, timestamp, uuid } from "drizzle-orm/pg-core";
import { servers } from "./servers";

// Time series behind the "últimas 24h/7d" charts (Fase 5) — server_metrics already read a live
// snapshot every ~60s (serverMetrics.ts) and only kept the latest one on the servers row; these two
// tables keep every sample instead, pruned to the last 7 days on each write.

export const serverMetricSamples = pgTable(
  "server_metric_samples",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    serverId: uuid("server_id")
      .references(() => servers.id, { onDelete: "cascade" })
      .notNull(),
    cpuPercent: real("cpu_percent").notNull(),
    memPercent: real("mem_percent").notNull(),
    diskPercent: real("disk_percent").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("server_metric_samples_server_time_idx").on(table.serverId, table.capturedAt)],
);

export const metricResourceTypeEnum = pgEnum("metric_resource_type", ["application", "database", "service"]);

// resource_id has no FK: it points at applications, databases or services depending on
// resource_type (same reasoning as volume_backups.owner_id) — deleting the resource just leaves its
// old samples to be pruned by age like everyone else's.
//
// Scope: only resources with exactly one container (an app whose build pack isn't docker_compose, a
// database, a legacy single-container service) — `docker stats` alone can't tell which compose
// project a container belongs to without a second docker inspect per container, so multi-container
// apps/stacks are left to their existing on-demand "docker stats" tab instead (see docs/ROADMAP.md).
export const containerMetricSamples = pgTable(
  "container_metric_samples",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    serverId: uuid("server_id")
      .references(() => servers.id, { onDelete: "cascade" })
      .notNull(),
    resourceType: metricResourceTypeEnum("resource_type").notNull(),
    resourceId: uuid("resource_id").notNull(),
    cpuPercent: real("cpu_percent").notNull(),
    memPercent: real("mem_percent").notNull(),
    memUsedBytes: bigint("mem_used_bytes", { mode: "number" }).notNull(),
    netRxBytes: bigint("net_rx_bytes", { mode: "number" }).notNull(),
    netTxBytes: bigint("net_tx_bytes", { mode: "number" }).notNull(),
    pids: integer("pids").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("container_metric_samples_resource_time_idx").on(table.resourceType, table.resourceId, table.capturedAt)],
);

export type ServerMetricSample = typeof serverMetricSamples.$inferSelect;
export type ContainerMetricSample = typeof containerMetricSamples.$inferSelect;
