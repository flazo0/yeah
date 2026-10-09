import { describe, expect, test } from "bun:test";
import { retentionCutoff } from "./logRetention";

describe("retentionCutoff", () => {
  const now = new Date("2026-01-30T00:00:00Z");

  test("defaults to 90 days when LOG_RETENTION_DAYS is unset", () => {
    const cutoff = retentionCutoff(now, undefined);
    expect(cutoff).not.toBeNull();
    expect(cutoff!.getTime()).toBe(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  });

  test("defaults to 90 days when LOG_RETENTION_DAYS is an empty string", () => {
    expect(retentionCutoff(now, "")!.getTime()).toBe(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  });

  test("honors a custom day count", () => {
    expect(retentionCutoff(now, "7")!.getTime()).toBe(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  });

  test("0 disables the sweep", () => {
    expect(retentionCutoff(now, "0")).toBeNull();
  });

  test("a negative or non-numeric value also disables the sweep rather than throwing", () => {
    expect(retentionCutoff(now, "-5")).toBeNull();
    expect(retentionCutoff(now, "not-a-number")).toBeNull();
  });
});
