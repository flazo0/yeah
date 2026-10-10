import { describe, expect, test } from "bun:test";
import { generateApiToken, hashApiToken } from "./apiTokenAuth";

describe("generateApiToken / hashApiToken", () => {
  test("generates a recognizable, unique, high-entropy token", () => {
    const a = generateApiToken();
    expect(a).toMatch(/^yeah_[0-9a-f]{64}$/);
    expect(generateApiToken()).not.toBe(a);
  });

  test("hashing is deterministic, fixed-length, and never contains the raw token", () => {
    const a = generateApiToken();
    expect(hashApiToken(a)).toBe(hashApiToken(a));
    expect(hashApiToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashApiToken(a)).not.toContain(a);
  });

  test("different tokens hash differently", () => {
    expect(hashApiToken(generateApiToken())).not.toBe(hashApiToken(generateApiToken()));
  });
});
