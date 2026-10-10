import { describe, expect, test } from "bun:test";
import { createLogger, parseLogLevel } from "./logger";

const fixedNow = () => new Date("2026-01-02T03:04:05.000Z");

function capture(options: Parameters<typeof createLogger>[1] = {}) {
  const lines: Array<{ level: string; line: string }> = [];
  const logger = createLogger("api", { ...options, now: fixedNow, sink: (level, line) => lines.push({ level, line }) });
  return { logger, lines };
}

describe("logger", () => {
  test("emits one JSON object per line with level, service and fields", () => {
    const { logger, lines } = capture();
    logger.info("hello", { a: 1 });
    expect(JSON.parse(lines[0]!.line)).toEqual({ ts: "2026-01-02T03:04:05.000Z", level: "info", service: "api", msg: "hello", a: 1 });
  });
  test("child loggers add correlation fields to every line", () => {
    const { logger, lines } = capture();
    logger.child({ requestId: "r1" }).child({ jobId: "j1" }).warn("x");
    expect(JSON.parse(lines[0]!.line)).toMatchObject({ requestId: "r1", jobId: "j1", level: "warn" });
  });
  test("respects the minimum level", () => {
    const { logger, lines } = capture({ minLevel: "warn" });
    logger.info("no");
    logger.debug("no");
    logger.error("yes");
    expect(lines.map((l) => l.level)).toEqual(["error"]);
  });
  test("serializes Error values", () => {
    const { logger, lines } = capture();
    logger.error("boom", { err: new Error("bad") });
    expect(JSON.parse(lines[0]!.line).err).toMatchObject({ name: "Error", message: "bad" });
  });
  test("text format and level parsing", () => {
    const { logger, lines } = capture({ format: "text" });
    logger.info("hi", { k: "v" });
    expect(lines[0]!.line).toBe('2026-01-02T03:04:05.000Z INFO [api] hi {"k":"v"}');
    expect(parseLogLevel("debug")).toBe("debug");
    expect(parseLogLevel("nope")).toBe("info");
  });
});
