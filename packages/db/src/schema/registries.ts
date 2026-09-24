import { pgTable, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { encryptedText } from "../encryption";
import { teams } from "./teams";

// A private container registry a team can pull from and push built images to. The password is
// encrypted at rest like every other secret, and never returned by the API.
export const registries = pgTable(
  "registries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    teamId: uuid("team_id")
      .references(() => teams.id, { onDelete: "cascade" })
      .notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    // host[:port] only — "ghcr.io", "registry.example.com:5000".
    host: varchar("host", { length: 255 }).notNull(),
    username: varchar("username", { length: 255 }).notNull(),
    password: encryptedText("password").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [unique("registries_team_name_unique").on(table.teamId, table.name)],
);

export type Registry = typeof registries.$inferSelect;
