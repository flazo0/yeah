import { describe, expect, test } from "bun:test";
import { formatSemVer, isBehind, latestPatch, parseSemVer } from "./proxyVersion";

describe("proxy version", () => {
  test("parses the CLI output and tags", () => {
    expect(parseSemVer("Version:      2.11.14\nCodename:     comte\n")).toEqual({ major: 2, minor: 11, patch: 14 });
    expect(parseSemVer("v3.1.0")).toEqual({ major: 3, minor: 1, patch: 0 });
    expect(parseSemVer("no version here")).toBeNull();
  });

  test("latest patch of the same line, ignoring pre-releases and other lines", () => {
    const tags = ["v2.11.9", "v2.11.14", "v2.11.15-rc1", "v2.10.99", "v3.0.0", "v2.11.2"];
    expect(formatSemVer(latestPatch(tags, { major: 2, minor: 11 })!)).toBe("2.11.14");
    expect(latestPatch(["v3.0.0"], { major: 2, minor: 11 })).toBeNull();
  });

  test("behind only within the same line", () => {
    expect(isBehind({ major: 2, minor: 11, patch: 2 }, { major: 2, minor: 11, patch: 14 })).toBe(true);
    expect(isBehind({ major: 2, minor: 11, patch: 14 }, { major: 2, minor: 11, patch: 14 })).toBe(false);
    expect(isBehind({ major: 2, minor: 11, patch: 2 }, { major: 3, minor: 0, patch: 5 })).toBe(false);
  });
});
