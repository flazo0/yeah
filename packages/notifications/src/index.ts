export type NotificationLevel = "info" | "warning" | "error";

export interface NotificationMessage {
  title: string;
  body: string;
  level: NotificationLevel;
}

export interface NotificationChannelConfig {
  type: "discord" | "slack" | "telegram" | "webhook";
  url: string | null;
  telegramBotToken: string | null;
  telegramChatId: string | null;
}

const LEVEL_EMOJI: Record<NotificationLevel, string> = { info: "ℹ️", warning: "⚠️", error: "🔴" };
// Discord embed side-bar colors (decimal), Slack attachment colors (hex) — same palette either way.
const LEVEL_COLOR: Record<NotificationLevel, number> = { info: 0x3b82f6, warning: 0xf59e0b, error: 0xef4444 };

/**
 * Best-effort delivery — a broken webhook URL or a down notification provider should never
 * crash the deploy/backup/monitoring job that triggered the alert. Callers just fire-and-forget.
 */
export async function sendNotification(channel: NotificationChannelConfig, message: NotificationMessage): Promise<boolean> {
  try {
    switch (channel.type) {
      case "discord":
        return await sendDiscord(channel.url, message);
      case "slack":
        return await sendSlack(channel.url, message);
      case "telegram":
        return await sendTelegram(channel.telegramBotToken, channel.telegramChatId, message);
      case "webhook":
        return await sendWebhook(channel.url, message);
    }
  } catch (err) {
    console.error(`[notifications] failed to send via ${channel.type}:`, err);
    return false;
  }
}

async function sendDiscord(url: string | null, message: NotificationMessage): Promise<boolean> {
  if (!url) return false;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      embeds: [{ title: `${LEVEL_EMOJI[message.level]} ${message.title}`, description: message.body, color: LEVEL_COLOR[message.level] }],
    }),
  });
  return res.ok;
}

async function sendSlack(url: string | null, message: NotificationMessage): Promise<boolean> {
  if (!url) return false;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: `${LEVEL_EMOJI[message.level]} *${message.title}*\n${message.body}`,
    }),
  });
  return res.ok;
}

async function sendTelegram(botToken: string | null, chatId: string | null, message: NotificationMessage): Promise<boolean> {
  if (!botToken || !chatId) return false;
  const text = `${LEVEL_EMOJI[message.level]} *${escapeMarkdown(message.title)}*\n${escapeMarkdown(message.body)}`;
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "MarkdownV2" }),
  });
  return res.ok;
}

async function sendWebhook(url: string | null, message: NotificationMessage): Promise<boolean> {
  if (!url) return false;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...message, timestamp: new Date().toISOString() }),
  });
  return res.ok;
}

// Telegram's MarkdownV2 treats most punctuation as formatting syntax — anything in a title/body
// we didn't author ourselves (a repo name, an error message) needs every one of these escaped.
export function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
}
