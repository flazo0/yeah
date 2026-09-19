import nodemailer from "nodemailer";

export type NotificationLevel = "info" | "warning" | "error";

export interface NotificationMessage {
  title: string;
  body: string;
  level: NotificationLevel;
}

export interface NotificationChannelConfig {
  type: "discord" | "slack" | "telegram" | "webhook" | "email";
  url: string | null;
  telegramBotToken: string | null;
  telegramChatId: string | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecure: boolean | null;
  smtpUser: string | null;
  smtpPassword: string | null;
  smtpFrom: string | null;
  emailTo: string | null;
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
      case "email":
        return await sendEmail(channel, message);
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

const LEVEL_LABEL: Record<NotificationLevel, string> = { info: "Info", warning: "Aviso", error: "Erro" };
// Same palette as LEVEL_COLOR above, as CSS hex instead of Discord/Slack's decimal.
const LEVEL_HEX: Record<NotificationLevel, string> = { info: "#3b82f6", warning: "#f59e0b", error: "#ef4444" };

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** A self-contained HTML email (inline CSS — most mail clients strip <style> blocks) plus a
 * plain-text fallback, styled to look like it actually came from the product instead of a bare
 * SMTP relay dump. */
export function renderEmail(message: NotificationMessage): { subject: string; html: string; text: string } {
  const accent = LEVEL_HEX[message.level];
  const bodyHtml = escapeHtml(message.body).replace(/\n/g, "<br />");
  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <table role="presentation" width="100%" style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7;">
      <tr>
        <td style="height:4px;background:${accent};font-size:0;line-height:0;">&nbsp;</td>
      </tr>
      <tr>
        <td style="padding:28px 28px 8px;">
          <span style="display:inline-block;padding:2px 10px;border-radius:999px;background:${accent}1a;color:${accent};font-size:12px;font-weight:600;letter-spacing:0.02em;">${LEVEL_LABEL[message.level]}</span>
        </td>
      </tr>
      <tr>
        <td style="padding:8px 28px 4px;">
          <h1 style="margin:0;font-size:18px;line-height:1.4;color:#18181b;">${escapeHtml(message.title)}</h1>
        </td>
      </tr>
      <tr>
        <td style="padding:8px 28px 28px;">
          <p style="margin:0;font-size:14px;line-height:1.6;color:#52525b;white-space:pre-wrap;">${bodyHtml}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:16px 28px;border-top:1px solid #f4f4f5;">
          <p style="margin:0;font-size:12px;color:#a1a1aa;">yeah · ${new Date().toLocaleString("pt-BR")}</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
  return { subject: `[yeah] ${message.title}`, html, text: `${LEVEL_LABEL[message.level]}: ${message.title}\n\n${message.body}` };
}

async function sendEmail(channel: NotificationChannelConfig, message: NotificationMessage): Promise<boolean> {
  if (!channel.smtpHost || !channel.smtpPort || !channel.smtpFrom || !channel.emailTo) return false;

  const transport = nodemailer.createTransport({
    host: channel.smtpHost,
    port: channel.smtpPort,
    secure: channel.smtpSecure ?? channel.smtpPort === 465,
    auth: channel.smtpUser && channel.smtpPassword ? { user: channel.smtpUser, pass: channel.smtpPassword } : undefined,
  });

  const { subject, html, text } = renderEmail(message);
  const info = await transport.sendMail({ from: channel.smtpFrom, to: channel.emailTo, subject, html, text });
  // nodemailer resolves even for some rejected recipients — only treat it as delivered if the
  // server didn't reject every single one.
  return info.accepted.length > 0;
}

// Telegram's MarkdownV2 treats most punctuation as formatting syntax — anything in a title/body
// we didn't author ourselves (a repo name, an error message) needs every one of these escaped.
export function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
}
