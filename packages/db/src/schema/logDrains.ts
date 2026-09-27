import { boolean, pgEnum, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { teams } from "./teams";
import { encryptedText } from "../encryption";

export const logDrainKindEnum = pgEnum("log_drain_kind", ["loki", "axiom", "new_relic", "fluent_bit_http"]);

// Forwards the logs the panel already captures in full at the end of a job (an application deploy, a
// scheduled task run) to an external log aggregator — one row per destination, per team. Not a
// continuous tail of container stdout (see docs/ROADMAP.md for that boundary).
export const logDrains = pgTable("log_drains", {
  id: uuid("id").defaultRandom().primaryKey(),
  teamId: uuid("team_id")
    .references(() => teams.id, { onDelete: "cascade" })
    .notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  kind: logDrainKindEnum("kind").notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  // loki: push endpoint base URL. fluent_bit_http: the URL of its http input plugin. Unused otherwise.
  url: varchar("url", { length: 1024 }),
  lokiUsername: varchar("loki_username", { length: 255 }),
  lokiPassword: encryptedText("loki_password"),
  axiomDataset: varchar("axiom_dataset", { length: 255 }),
  axiomToken: encryptedText("axiom_token"),
  newRelicLicenseKey: encryptedText("new_relic_license_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type LogDrain = typeof logDrains.$inferSelect;
export type NewLogDrain = typeof logDrains.$inferInsert;
