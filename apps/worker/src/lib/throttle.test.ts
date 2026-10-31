import { describe, expect, test } from "bun:test";
import { Throttle } from "./throttle";

describe("Throttle", () => {
  test("one per window per key, again after the window", () => {
    let now = 0;
    const t = new Throttle(1000, () => now);
    expect(t.allow("a")).toBe(true);
    expect(t.allow("a")).toBe(false);
    expect(t.allow("b")).toBe(true);
    now = 1001;
    expect(t.allow("a")).toBe(true);
  });
});
