import { boolean, integer, pgEnum, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { teams } from "./teams";

export const notificationChannelTypeEnum = pgEnum("notification_channel_type", [
  "discord",
  "slack",
  "telegram",
  "webhook",
  "email",
]);

export const notificationChannels = pgTable("notification_channels", {
  id: uuid("id").defaultRandom().primaryKey(),
  teamId: uuid("team_id")
    .references(() => teams.id, { onDelete: "cascade" })
    .notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  type: notificationChannelTypeEnum("type").notNull(),
  // discord/slack/webhook: the URL to POST to. telegram/email: unused (see fields below).
  url: varchar("url", { length: 1024 }),
  telegramBotToken: varchar("telegram_bot_token", { length: 255 }),
  telegramChatId: varchar("telegram_chat_id", { length: 255 }),
  // email: any SMTP server works (Gmail, SES, SendGrid, a self-hosted Postfix, ...) — no
  // proprietary provider API, matching how Coolify's own email notifications work.
  // TODO(security): smtpPassword is plaintext, same known gap as servers.private_key.
  smtpHost: varchar("smtp_host", { length: 255 }),
  smtpPort: integer("smtp_port"),
  smtpSecure: boolean("smtp_secure"),
  smtpUser: varchar("smtp_user", { length: 255 }),
  smtpPassword: varchar("smtp_password", { length: 255 }),
  smtpFrom: varchar("smtp_from", { length: 255 }),
  emailTo: varchar("email_to", { length: 255 }),
  // null = every event type (the original, backward-compatible behavior). Set = only these.
  events: text("events").array(),
  enabled: boolean("enabled").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type NotificationChannel = typeof notificationChannels.$inferSelect;
export type NewNotificationChannel = typeof notificationChannels.$inferInsert;
