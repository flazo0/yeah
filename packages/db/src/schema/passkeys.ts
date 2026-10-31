import { integer, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { users } from "./users";

// WebAuthn credentials (Touch ID, Windows Hello, security keys…). A passkey signs in on its own — it already
// proves possession of the device and (with user verification) the person — so it replaces password + TOTP.
export const passkeys = pgTable("passkeys", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  // base64url credential id as the authenticator reports it, and its COSE public key (base64url).
  credentialId: varchar("credential_id", { length: 1024 }).notNull().unique(),
  publicKey: text("public_key").notNull(),
  counter: integer("counter").default(0).notNull(),
  transports: text("transports"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
});

export type Passkey = typeof passkeys.$inferSelect;
