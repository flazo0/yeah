import { describe, expect, test } from "bun:test";
import { intervalMsFromEnv } from "./intervals";

describe("intervalMsFromEnv", () => {
  test("uses the default when unset or invalid", () => {
    expect(intervalMsFromEnv(undefined, 60, 15)).toBe(60_000);
    expect(intervalMsFromEnv("abc", 60, 15)).toBe(60_000);
    expect(intervalMsFromEnv("-5", 60, 15)).toBe(60_000);
  });
  test("honours a valid value and clamps to the bounds", () => {
    expect(intervalMsFromEnv("120", 60, 15)).toBe(120_000);
    expect(intervalMsFromEnv("1", 60, 15)).toBe(15_000);
    expect(intervalMsFromEnv("999999", 60, 15)).toBe(86_400_000);
  });
});
