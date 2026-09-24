import { pgEnum, pgTable, primaryKey, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { teams } from "./teams";

export const taggableTypeEnum = pgEnum("taggable_type", ["application", "database", "service"]);

// Free-form labels a team attaches to resources to group and filter them ("prod", "cliente-x").
export const tags = pgTable(
  "tags",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    teamId: uuid("team_id")
      .references(() => teams.id, { onDelete: "cascade" })
      .notNull(),
    name: varchar("name", { length: 50 }).notNull(),
    color: varchar("color", { length: 7 }).default("#6366f1").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [unique("tags_team_name_unique").on(table.teamId, table.name)],
);

// resource_id points at applications / databases / services depending on resource_type, so there is
// no FK — the delete routes of those resources clear their rows here.
export const resourceTags = pgTable(
  "resource_tags",
  {
    tagId: uuid("tag_id")
      .references(() => tags.id, { onDelete: "cascade" })
      .notNull(),
    resourceType: taggableTypeEnum("resource_type").notNull(),
    resourceId: uuid("resource_id").notNull(),
  },
  (table) => [primaryKey({ columns: [table.tagId, table.resourceType, table.resourceId] })],
);

export type Tag = typeof tags.$inferSelect;
