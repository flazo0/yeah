import { describe, expect, test } from "bun:test";
import { crossedThreshold, parseMetrics } from "./serverMetrics.commands";

describe("parseMetrics", () => {
  test("parses well-formed output", () => {
    expect(parseMetrics("CPU:42\nMEM:73\nDISK:12\n")).toEqual({ cpu: 42, mem: 73, disk: 12 });
  });

  test("parses regardless of surrounding noise/order in the SSH output", () => {
    expect(parseMetrics("some banner\nDISK:5\nCPU:0\nMEM:99\ntrailing junk")).toEqual({ cpu: 0, mem: 99, disk: 5 });
  });

  test("returns null when a field is missing", () => {
    expect(parseMetrics("CPU:42\nMEM:73\n")).toBeNull();
  });

  test("returns null on completely unparseable output (e.g. a shell error)", () => {
    expect(parseMetrics("sh: /proc/stat: No such file or directory")).toBeNull();
  });

  test("returns null on empty output", () => {
    expect(parseMetrics("")).toBeNull();
  });
});

describe("crossedThreshold", () => {
  test("no previous reading + already over threshold counts as a crossing", () => {
    expect(crossedThreshold(null, 95, 90)).toBe(true);
  });

  test("no previous reading + under threshold does not alert", () => {
    expect(crossedThreshold(null, 50, 90)).toBe(false);
  });

  test("transition from under to over threshold alerts", () => {
    expect(crossedThreshold(85, 92, 90)).toBe(true);
  });

  test("staying over threshold does not re-alert", () => {
    expect(crossedThreshold(93, 95, 90)).toBe(false);
  });

  test("staying under threshold does not alert", () => {
    expect(crossedThreshold(50, 60, 90)).toBe(false);
  });

  test("dropping back under threshold does not alert", () => {
    expect(crossedThreshold(95, 80, 90)).toBe(false);
  });

  test("exactly at the threshold counts as crossed", () => {
    expect(crossedThreshold(89, 90, 90)).toBe(true);
  });
});
