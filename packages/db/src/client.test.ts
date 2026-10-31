import { describe, expect, test } from "bun:test";
import { poolMaxFromEnv } from "./client";

describe("poolMaxFromEnv", () => {
  test("accepts positive integers only", () => {
    expect(poolMaxFromEnv("5")).toBe(5);
    expect(poolMaxFromEnv(undefined)).toBeUndefined();
    expect(poolMaxFromEnv("")).toBeUndefined();
    expect(poolMaxFromEnv("0")).toBeUndefined();
    expect(poolMaxFromEnv("-2")).toBeUndefined();
    expect(poolMaxFromEnv("2.5")).toBeUndefined();
    expect(poolMaxFromEnv("abc")).toBeUndefined();
  });
});
