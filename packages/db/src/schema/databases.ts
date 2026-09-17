import { integer, pgEnum, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { teams } from "./teams";
import { servers } from "./servers";
import { environments } from "./projects";
import { resourceLimitColumns } from "./columns";

export const databaseEngineEnum = pgEnum("database_engine", ["postgresql", "mysql", "mariadb", "redis", "mongodb"]);
export const databaseStatusEnum = pgEnum("database_status", ["idle", "provisioning", "running", "error"]);

export const databases = pgTable("databases", {
  id: uuid("id").defaultRandom().primaryKey(),
  teamId: uuid("team_id")
    .references(() => teams.id, { onDelete: "cascade" })
    .notNull(),
  environmentId: uuid("environment_id")
    .references(() => environments.id, { onDelete: "cascade" })
    .notNull(),
  serverId: uuid("server_id")
    .references(() => servers.id, { onDelete: "cascade" })
    .notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  engine: databaseEngineEnum("engine").default("postgresql").notNull(),
  image: varchar("image", { length: 255 }).default("postgres:16-alpine").notNull(),
  port: integer("port").default(5432).notNull(),
  // Redis has no login user — null for that engine, set for the others.
  username: varchar("username", { length: 255 }),
  // TODO(security): same as servers.private_key — needs encryption at rest before production.
  password: varchar("password", { length: 255 }).notNull(),
  // Redis has no named database either — null for that engine, set for the others.
  databaseName: varchar("database_name", { length: 255 }),
  ...resourceLimitColumns(),
  status: databaseStatusEnum("status").default("idle").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Database = typeof databases.$inferSelect;
export type NewDatabase = typeof databases.$inferInsert;
