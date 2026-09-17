import { boolean, pgEnum, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { teams } from "./teams";

export const notificationChannelTypeEnum = pgEnum("notification_channel_type", [
  "discord",
  "slack",
  "telegram",
  "webhook",
]);

export const notificationChannels = pgTable("notification_channels", {
  id: uuid("id").defaultRandom().primaryKey(),
  teamId: uuid("team_id")
    .references(() => teams.id, { onDelete: "cascade" })
    .notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  type: notificationChannelTypeEnum("type").notNull(),
  // discord/slack/webhook: the URL to POST to. telegram: unused (see botToken/chatId below).
  url: varchar("url", { length: 1024 }),
  telegramBotToken: varchar("telegram_bot_token", { length: 255 }),
  telegramChatId: varchar("telegram_chat_id", { length: 255 }),
  // null = every event type (the original, backward-compatible behavior). Set = only these.
  events: text("events").array(),
  enabled: boolean("enabled").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type NotificationChannel = typeof notificationChannels.$inferSelect;
export type NewNotificationChannel = typeof notificationChannels.$inferInsert;
