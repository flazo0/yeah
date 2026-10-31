import { describe, expect, test } from "bun:test";
import { hashPassword, verifyPassword } from "./password";

describe("hashPassword / verifyPassword", () => {
  test("a hashed password verifies against the original", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
  });

  test("a wrong password fails verification", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("wrong password", hash)).toBe(false);
  });

  test("never stores the password in plaintext", async () => {
    const password = "correct horse battery staple";
    const hash = await hashPassword(password);
    expect(hash).not.toContain(password);
  });

  test("uses argon2id", async () => {
    const hash = await hashPassword("anything");
    expect(hash.startsWith("$argon2id$")).toBe(true);
  });

  test("the same password hashes differently each time (random salt)", async () => {
    const [a, b] = await Promise.all([hashPassword("same password"), hashPassword("same password")]);
    expect(a).not.toBe(b);
    expect(await verifyPassword("same password", a)).toBe(true);
    expect(await verifyPassword("same password", b)).toBe(true);
  });
});
