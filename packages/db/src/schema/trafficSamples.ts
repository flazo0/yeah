import { bigint, index, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { applications } from "./applications";

// Time series behind "Analytics de tráfego por aplicação" (Fase 5) — cumulative request counts read
// from Traefik's own Prometheus metrics (traefik_router_requests_total), never from parsing an access
// log file: no agent, no log file growing on the server, just one more number read over the same
// ephemeral SSH connection the other metrics already use. requestCount is the raw cumulative counter
// at capturedAt (like Prometheus itself), not a delta — the reader computes the delta between
// consecutive samples, so a missed tick just shows a bigger window instead of losing data.
//
// Scope: applications only (what the roadmap item asks for), and only ones with a domain (no router,
// no traffic to count). Pruned to 30 days on each write — shorter than the 7-day CPU/mem window
// because requests accumulate faster and the exact count matters less the older it gets.
export const applicationTrafficSamples = pgTable(
  "application_traffic_samples",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    applicationId: uuid("application_id")
      .references(() => applications.id, { onDelete: "cascade" })
      .notNull(),
    requestCount: bigint("request_count", { mode: "number" }).notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("application_traffic_samples_app_time_idx").on(table.applicationId, table.capturedAt)],
);

export type ApplicationTrafficSample = typeof applicationTrafficSamples.$inferSelect;
