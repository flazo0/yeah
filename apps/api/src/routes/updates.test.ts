import { describe, expect, test } from "bun:test";
import { compareVersionParts, parseVersionTag } from "./updates.pure";

describe("parseVersionTag", () => {
  test("parses a bare version", () => {
    expect(parseVersionTag("16")).toEqual({ hasV: false, parts: [16], suffix: "" });
  });

  test("parses a 'v'-prefixed version", () => {
    expect(parseVersionTag("v2.11")).toEqual({ hasV: true, parts: [2, 11], suffix: "" });
  });

  test("parses a numeric suffix like -alpine", () => {
    expect(parseVersionTag("16-alpine")).toEqual({ hasV: false, parts: [16], suffix: "-alpine" });
  });

  test("parses up to four version segments", () => {
    expect(parseVersionTag("1.2.3.4")).toEqual({ hasV: false, parts: [1, 2, 3, 4], suffix: "" });
  });

  // This is the exact shape that caused the original Docker Hub bug: a platform variant tag with
  // no leading digits at all should be rejected outright, not parsed into garbage.
  test("rejects a tag with no version number (platform variant)", () => {
    expect(parseVersionTag("windowsservercore-ltsc2025")).toBeNull();
  });

  test("rejects an empty string", () => {
    expect(parseVersionTag("")).toBeNull();
  });
});

describe("compareVersionParts", () => {
  test("returns 0 for identical versions", () => {
    expect(compareVersionParts([2, 11], [2, 11])).toBe(0);
  });

  test("returns positive when a > b", () => {
    expect(compareVersionParts([3, 0], [2, 11])).toBeGreaterThan(0);
  });

  test("returns negative when a < b", () => {
    expect(compareVersionParts([2, 5], [2, 11])).toBeLessThan(0);
  });

  test("treats a missing trailing segment as 0", () => {
    expect(compareVersionParts([2], [2, 0])).toBe(0);
    expect(compareVersionParts([2, 1], [2])).toBeGreaterThan(0);
  });

  // The actual bug: naive "most recently pushed" comparison would have picked
  // "windowsservercore-ltsc2025" over "v2.11" for traefik. With shape-filtering in place
  // (hasV/suffix must match — exercised at the latestDockerHubTag level, not shown here),
  // this at least confirms the numeric comparison itself is correct for the real traefik case.
  test("traefik v2.11 -> v3.7.13 is recognized as an upgrade", () => {
    expect(compareVersionParts([3, 7, 13], [2, 11])).toBeGreaterThan(0);
  });
});
