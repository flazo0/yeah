import { pgTable, text, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { teams } from "./teams";
import { encryptedText } from "../encryption";

// A reusable SSH keypair, managed once and referenced when adding a server or a private-repo deploy
// key, instead of generating (and re-authorizing) a fresh one every time. The private key is only ever
// used server-side (copied into servers.private_key / applications.deploy_key at the point of use) —
// the API never returns it once stored.
export const sshKeys = pgTable(
  "ssh_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    teamId: uuid("team_id")
      .references(() => teams.id, { onDelete: "cascade" })
      .notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    // Encrypted at rest (AES-256-GCM, see ../encryption.ts).
    privateKey: encryptedText("private_key").notNull(),
    // Public keys aren't secret — kept in the clear so the list screen can show/copy them directly.
    publicKey: text("public_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [unique("ssh_keys_team_name_unique").on(table.teamId, table.name)],
);

export type SshKey = typeof sshKeys.$inferSelect;
export type NewSshKey = typeof sshKeys.$inferInsert;
