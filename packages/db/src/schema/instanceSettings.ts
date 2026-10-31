import { pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

// Settings of the whole installation (not of a team). There is one row, created the first time something is saved.
export const instanceSettings = pgTable("instance_settings", {
  id: uuid("id").defaultRandom().primaryKey(),
  // Hostname the panel itself is served on (HTTPS through the platform server's Traefik). null = not configured.
  panelDomain: varchar("panel_domain", { length: 255 }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type InstanceSettings = typeof instanceSettings.$inferSelect;
