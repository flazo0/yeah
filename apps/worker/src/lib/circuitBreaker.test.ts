import { describe, expect, test } from "bun:test";
import { CircuitBreaker } from "./circuitBreaker";

const options = { threshold: 3, baseCooldownMs: 1000, maxCooldownMs: 4000 };

describe("CircuitBreaker", () => {
  test("stays closed below the threshold", () => {
    const b = new CircuitBreaker(options);
    b.recordFailure("s", 0);
    b.recordFailure("s", 0);
    expect(b.shouldAttempt("s", 0)).toBe(true);
  });

  test("opens at the threshold, reports the transition once, then half-opens after the cooldown", () => {
    const b = new CircuitBreaker(options);
    expect(b.recordFailure("s", 0)).toBeNull();
    expect(b.recordFailure("s", 0)).toBeNull();
    expect(b.recordFailure("s", 0)).toBe("opened");
    expect(b.shouldAttempt("s", 999)).toBe(false);
    expect(b.shouldAttempt("s", 1000)).toBe(true);
    expect(b.recordFailure("s", 1000)).toBeNull();
  });

  test("cooldown doubles per extra failure and is capped", () => {
    const b = new CircuitBreaker(options);
    for (let i = 0; i < 3; i++) b.recordFailure("s", 0);
    b.recordFailure("s", 1000);
    expect(b.shouldAttempt("s", 2999)).toBe(false);
    expect(b.shouldAttempt("s", 3000)).toBe(true);
    for (let i = 0; i < 5; i++) b.recordFailure("s", 10_000);
    expect(b.shouldAttempt("s", 10_000 + 3999)).toBe(false);
    expect(b.shouldAttempt("s", 10_000 + 4000)).toBe(true);
  });

  test("success closes the circuit and reports it only if it had opened", () => {
    const b = new CircuitBreaker(options);
    b.recordFailure("s", 0);
    expect(b.recordSuccess("s")).toBeNull();
    for (let i = 0; i < 3; i++) b.recordFailure("s", 0);
    expect(b.recordSuccess("s")).toBe("closed");
    expect(b.shouldAttempt("s", 0)).toBe(true);
  });

  test("keys are independent", () => {
    const b = new CircuitBreaker(options);
    for (let i = 0; i < 3; i++) b.recordFailure("a", 0);
    expect(b.shouldAttempt("a", 0)).toBe(false);
    expect(b.shouldAttempt("b", 0)).toBe(true);
  });
});
