import { describe, expect, mock, test } from "bun:test";
import { buildAxiomPayload, buildFluentBitPayload, buildLokiPayload, buildNewRelicPayload, sendLogs, splitLogLines, type LogDrainConfig, type LogLine } from "./index";

function baseDrain(overrides: Partial<LogDrainConfig> = {}): LogDrainConfig {
  return { kind: "loki", url: null, lokiUsername: null, lokiPassword: null, axiomDataset: null, axiomToken: null, newRelicLicenseKey: null, ...overrides };
}

const lines: LogLine[] = [
  { message: "$ preparando o deploy", timestamp: new Date("2026-01-01T00:00:00.000Z"), labels: { app: "api", job: "deploy" } },
  { message: "Deploy concluído.", timestamp: new Date("2026-01-01T00:00:01.000Z"), labels: { app: "api", job: "deploy" } },
];

describe("splitLogLines", () => {
  test("strips ANSI color codes, trims trailing whitespace and drops blank lines", () => {
    expect(splitLogLines("\x1b[36m$ passo 1\x1b[0m\n\nsaída\n\x1b[32mOK\x1b[0m\n")).toEqual(["$ passo 1", "saída", "OK"]);
  });
  test("empty log -> no lines", () => {
    expect(splitLogLines("")).toEqual([]);
    expect(splitLogLines("\n\n")).toEqual([]);
  });
});

describe("payload builders", () => {
  test("loki: one stream, shared labels, nanosecond timestamps as strings", () => {
    const payload = buildLokiPayload(lines);
    expect(payload.streams).toHaveLength(1);
    expect(payload.streams[0]!.stream).toEqual({ app: "api", job: "deploy" });
    expect(payload.streams[0]!.values).toEqual([
      ["1767225600000000000", "$ preparando o deploy"],
      ["1767225601000000000", "Deploy concluído."],
    ]);
  });

  test("axiom: one row per line, labels spread in, _time as ISO", () => {
    const payload = buildAxiomPayload(lines);
    expect(payload).toEqual([
      { _time: "2026-01-01T00:00:00.000Z", message: "$ preparando o deploy", app: "api", job: "deploy" },
      { _time: "2026-01-01T00:00:01.000Z", message: "Deploy concluído.", app: "api", job: "deploy" },
    ]);
  });

  test("new relic: common attributes once, epoch-ms timestamps per log", () => {
    const payload = buildNewRelicPayload(lines);
    expect(payload).toEqual([{ common: { attributes: { app: "api", job: "deploy" } }, logs: [{ timestamp: 1767225600000, message: "$ preparando o deploy" }, { timestamp: 1767225601000, message: "Deploy concluído." }] }]);
  });

  test("fluent bit: one record per line with time + labels spread in", () => {
    const payload = buildFluentBitPayload(lines);
    expect(payload[0]).toEqual({ time: "2026-01-01T00:00:00.000Z", message: "$ preparando o deploy", app: "api", job: "deploy" });
  });
});

describe("sendLogs", () => {
  test("empty batch is a no-op success, no network call", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("should not be called");
    }) as unknown as typeof fetch;
    expect(await sendLogs(baseDrain(), [])).toBe(true);
  });

  test("loki: posts to <url>/loki/api/v1/push, basic auth only when both fields are set", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};
    globalThis.fetch = mock(async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedHeaders = init.headers as Record<string, string>;
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;

    const ok = await sendLogs(baseDrain({ kind: "loki", url: "https://loki.example.com/" }), lines);
    expect(ok).toBe(true);
    expect(capturedUrl).toBe("https://loki.example.com/loki/api/v1/push");
    expect(capturedHeaders.Authorization).toBeUndefined();

    await sendLogs(baseDrain({ kind: "loki", url: "https://loki.example.com", lokiUsername: "u", lokiPassword: "p" }), lines);
    expect(capturedHeaders.Authorization).toBe(`Basic ${Buffer.from("u:p").toString("base64")}`);
  });

  test("loki: no url -> false, no network call", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("should not be called");
    }) as unknown as typeof fetch;
    expect(await sendLogs(baseDrain({ kind: "loki" }), lines)).toBe(false);
  });

  test("axiom: bearer token and dataset in the URL, false when either is missing", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};
    globalThis.fetch = mock(async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedHeaders = init.headers as Record<string, string>;
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;

    const ok = await sendLogs(baseDrain({ kind: "axiom", axiomDataset: "prod logs", axiomToken: "tok" }), lines);
    expect(ok).toBe(true);
    expect(capturedUrl).toBe("https://api.axiom.co/v1/datasets/prod%20logs/ingest");
    expect(capturedHeaders.Authorization).toBe("Bearer tok");
    expect(await sendLogs(baseDrain({ kind: "axiom", axiomDataset: "x" }), lines)).toBe(false);
  });

  test("new relic: Api-Key header, false when the license key is missing", async () => {
    let capturedHeaders: Record<string, string> = {};
    globalThis.fetch = mock(async (_url: string, init: RequestInit) => {
      capturedHeaders = init.headers as Record<string, string>;
      return new Response(null, { status: 202 });
    }) as unknown as typeof fetch;

    expect(await sendLogs(baseDrain({ kind: "new_relic", newRelicLicenseKey: "lic" }), lines)).toBe(true);
    expect(capturedHeaders["Api-Key"]).toBe("lic");
    expect(await sendLogs(baseDrain({ kind: "new_relic" }), lines)).toBe(false);
  });

  test("fluent bit: plain POST to the configured url, false when it's missing", async () => {
    let capturedUrl = "";
    globalThis.fetch = mock(async (url: string) => {
      capturedUrl = url;
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;

    expect(await sendLogs(baseDrain({ kind: "fluent_bit_http", url: "http://collector:9880/logs" }), lines)).toBe(true);
    expect(capturedUrl).toBe("http://collector:9880/logs");
    expect(await sendLogs(baseDrain({ kind: "fluent_bit_http" }), lines)).toBe(false);
  });

  test("a non-2xx response or a thrown network error both resolve to false, never throw", async () => {
    globalThis.fetch = mock(async () => new Response(null, { status: 500 })) as unknown as typeof fetch;
    expect(await sendLogs(baseDrain({ kind: "loki", url: "https://loki.example.com" }), lines)).toBe(false);

    globalThis.fetch = mock(async () => {
      throw new Error("network is down");
    }) as unknown as typeof fetch;
    const originalError = console.error;
    console.error = () => {};
    try {
      expect(await sendLogs(baseDrain({ kind: "loki", url: "https://loki.example.com" }), lines)).toBe(false);
    } finally {
      console.error = originalError;
    }
  });
});
