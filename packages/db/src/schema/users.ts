import { boolean, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { encryptedText } from "../encryption";

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  name: varchar("name", { length: 255 }),
  /** Base32 TOTP secret, encrypted at rest; only enforced at login once `totpEnabled` is true. */
  totpSecret: encryptedText("totp_secret"),
  totpEnabled: boolean("totp_enabled").default(false).notNull(),
  /** JSON array of sha256 hashes of the unused one-time recovery codes. */
  totpRecoveryHashes: text("totp_recovery_hashes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
