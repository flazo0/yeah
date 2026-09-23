import { describe, expect, test } from "bun:test";
import { overloadReason } from "./serverLoad";

const now = Date.parse("2026-01-01T12:00:00Z");
const fresh = new Date(now - 60_000);

describe("overloadReason", () => {
  test("null when healthy", () => {
    expect(overloadReason({ name: "s", memPercent: 50, diskPercent: 60, metricsCheckedAt: fresh }, now)).toBeNull();
  });
  test("flags disk and memory at 95%+", () => {
    expect(overloadReason({ name: "s", memPercent: 50, diskPercent: 96.4, metricsCheckedAt: fresh }, now)).toContain("disco em 96%");
    const both = overloadReason({ name: "s", memPercent: 99, diskPercent: 95, metricsCheckedAt: fresh }, now);
    expect(both).toContain("disco em 95% e memória em 99%");
  });
  test("ignores missing or stale metrics", () => {
    expect(overloadReason({ name: "s", memPercent: 99, diskPercent: 99, metricsCheckedAt: null }, now)).toBeNull();
    expect(overloadReason({ name: "s", memPercent: 99, diskPercent: 99, metricsCheckedAt: new Date(now - 11 * 60_000) }, now)).toBeNull();
  });
});
