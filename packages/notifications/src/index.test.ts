import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  escapeHtml,
  escapeMarkdown,
  renderEmail,
  sendNotification,
  type NotificationChannelConfig,
  type NotificationMessage,
} from "./index";

describe("escapeMarkdown", () => {
  test("escapes every MarkdownV2 special character", () => {
    const input = "_*[]()~`>#+-=|{}.!";
    // Every character in the input is one of the special ones, each preceded by a backslash.
    expect(escapeMarkdown(input)).toBe(input.replace(/./g, (c) => `\\${c}`));
  });

  test("leaves plain text untouched", () => {
    expect(escapeMarkdown("deploy succeeded")).toBe("deploy succeeded");
  });

  test("escapes punctuation inside a realistic message", () => {
    expect(escapeMarkdown("repo: yeah (main) - build #42 failed!")).toBe(
      "repo: yeah \\(main\\) \\- build \\#42 failed\\!",
    );
  });
});

describe("escapeHtml", () => {
  test("escapes the five HTML-significant characters", () => {
    expect(escapeHtml(`<script>alert('&"')</script>`)).toBe(
      "&lt;script&gt;alert(&#39;&amp;&quot;&#39;)&lt;/script&gt;",
    );
  });

  test("leaves plain text untouched", () => {
    expect(escapeHtml("deploy succeeded")).toBe("deploy succeeded");
  });
});

describe("renderEmail", () => {
  test("prefixes the subject and includes the plain-text level label", () => {
    const { subject, text } = renderEmail({ title: "Deploy failed", body: "exit code 1", level: "error" });
    expect(subject).toBe("[yeah] Deploy failed");
    expect(text).toContain("Erro: Deploy failed");
    expect(text).toContain("exit code 1");
  });

  test("escapes an attacker-controlled title/body instead of injecting raw HTML", () => {
    const malicious: NotificationMessage = {
      title: `<img src=x onerror=alert(1)>`,
      body: `<script>alert('xss')</script>`,
      level: "warning",
    };
    const { html } = renderEmail(malicious);
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).not.toContain("<script>alert('xss')</script>");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  test("converts newlines in the body to <br /> for HTML rendering", () => {
    const { html } = renderEmail({ title: "t", body: "line one\nline two", level: "info" });
    expect(html).toContain("line one<br />line two");
  });
});

const message: NotificationMessage = { title: "Deploy ok", body: "yeah/api → prod", level: "info" };

function baseChannel(overrides: Partial<NotificationChannelConfig>): NotificationChannelConfig {
  return {
    type: "webhook",
    url: null,
    telegramBotToken: null,
    telegramChatId: null,
    smtpHost: null,
    smtpPort: null,
    smtpSecure: null,
    smtpUser: null,
    smtpPassword: null,
    smtpFrom: null,
    emailTo: null,
    ...overrides,
  };
}

describe("sendNotification", () => {
  afterEach(() => {
    // @ts-expect-error -- restoring the real fetch after each test
    delete globalThis.fetch;
  });

  test("returns false for discord without a url instead of throwing", async () => {
    const channel = baseChannel({ type: "discord" });
    expect(await sendNotification(channel, message)).toBe(false);
  });

  test("returns false for telegram missing bot token or chat id", async () => {
    const channel = baseChannel({ type: "telegram", telegramChatId: "123" });
    expect(await sendNotification(channel, message)).toBe(false);
  });

  test("returns false for email missing required smtp fields", async () => {
    const channel = baseChannel({ type: "email", smtpHost: "smtp.example.com" });
    expect(await sendNotification(channel, message)).toBe(false);
  });

  test("posts a discord embed with the right shape and returns true on 2xx", async () => {
    let capturedBody: unknown;
    globalThis.fetch = mock(async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;

    const channel = baseChannel({ type: "discord", url: "https://discord.example/webhook" });
    const ok = await sendNotification(channel, message);
    expect(ok).toBe(true);
    expect(capturedBody).toMatchObject({
      embeds: [{ title: expect.stringContaining("Deploy ok"), description: message.body }],
    });
  });

  test("escapes telegram text and returns false on a non-2xx response", async () => {
    let capturedBody: unknown;
    globalThis.fetch = mock(async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(null, { status: 400 });
    }) as unknown as typeof fetch;

    const channel = baseChannel({ type: "telegram", telegramBotToken: "bot123", telegramChatId: "chat456" });
    const dotted: NotificationMessage = { title: "yeah.api down", body: "check it!", level: "error" };
    const ok = await sendNotification(channel, dotted);
    expect(ok).toBe(false);
    expect((capturedBody as { text: string }).text).toContain("yeah\\.api down");
    expect((capturedBody as { text: string }).text).toContain("check it\\!");
  });

  test("never throws when the network call itself rejects", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("network is down");
    }) as unknown as typeof fetch;
    // sendNotification's catch block logs via console.error — take control of it explicitly
    // rather than relying on the ambient global, which the test runner doesn't guarantee is
    // still callable by the time an awaited rejection unwinds across multiple test files.
    const originalError = console.error;
    console.error = () => {};
    try {
      const channel = baseChannel({ type: "webhook", url: "https://example.com/hook" });
      expect(await sendNotification(channel, message)).toBe(false);
    } finally {
      console.error = originalError;
    }
  });
});
