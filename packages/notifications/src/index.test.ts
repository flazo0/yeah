import { afterEach, describe, expect, mock, test } from "bun:test";
import { escapeMarkdown, sendNotification, type NotificationChannelConfig, type NotificationMessage } from "./index";

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

const message: NotificationMessage = { title: "Deploy ok", body: "yeah/api → prod", level: "info" };

describe("sendNotification", () => {
  afterEach(() => {
    // @ts-expect-error -- restoring the real fetch after each test
    delete globalThis.fetch;
  });

  test("returns false for discord without a url instead of throwing", async () => {
    const channel: NotificationChannelConfig = { type: "discord", url: null, telegramBotToken: null, telegramChatId: null };
    expect(await sendNotification(channel, message)).toBe(false);
  });

  test("returns false for telegram missing bot token or chat id", async () => {
    const channel: NotificationChannelConfig = {
      type: "telegram",
      url: null,
      telegramBotToken: null,
      telegramChatId: "123",
    };
    expect(await sendNotification(channel, message)).toBe(false);
  });

  test("posts a discord embed with the right shape and returns true on 2xx", async () => {
    let capturedBody: unknown;
    globalThis.fetch = mock(async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;

    const channel: NotificationChannelConfig = {
      type: "discord",
      url: "https://discord.example/webhook",
      telegramBotToken: null,
      telegramChatId: null,
    };
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

    const channel: NotificationChannelConfig = {
      type: "telegram",
      url: null,
      telegramBotToken: "bot123",
      telegramChatId: "chat456",
    };
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
      const channel: NotificationChannelConfig = {
        type: "webhook",
        url: "https://example.com/hook",
        telegramBotToken: null,
        telegramChatId: null,
      };
      expect(await sendNotification(channel, message)).toBe(false);
    } finally {
      console.error = originalError;
    }
  });
});
