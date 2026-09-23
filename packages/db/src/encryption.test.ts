import { afterEach, describe, expect, test } from "bun:test";
import { decryptSecret, encryptSecret, isEncrypted } from "./encryption";

const original = { key: process.env.ENCRYPTION_KEY, prev: process.env.ENCRYPTION_KEY_PREVIOUS };

afterEach(() => {
  if (original.key === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = original.key;
  if (original.prev === undefined) delete process.env.ENCRYPTION_KEY_PREVIOUS;
  else process.env.ENCRYPTION_KEY_PREVIOUS = original.prev;
});

describe("secret encryption", () => {
  test("round-trips, including multi-line keys and unicode", () => {
    process.env.ENCRYPTION_KEY = "key-one";
    const pem = "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\ndef\n-----END OPENSSH PRIVATE KEY-----\n";
    for (const value of [pem, "senha-çãõ-🔐", "x"]) {
      const stored = encryptSecret(value);
      expect(isEncrypted(stored)).toBe(true);
      expect(stored).not.toContain("BEGIN");
      expect(decryptSecret(stored)).toBe(value);
    }
  });

  test("uses a fresh IV every time", () => {
    process.env.ENCRYPTION_KEY = "key-one";
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  test("legacy plaintext passes through untouched", () => {
    process.env.ENCRYPTION_KEY = "key-one";
    expect(decryptSecret("plain-old-password")).toBe("plain-old-password");
    expect(isEncrypted("plain-old-password")).toBe(false);
  });

  test("rejects a wrong key", () => {
    process.env.ENCRYPTION_KEY = "key-one";
    const stored = encryptSecret("secret");
    process.env.ENCRYPTION_KEY = "key-two";
    expect(() => decryptSecret(stored)).toThrow(/ENCRYPTION_KEY/);
  });

  test("detects tampering", () => {
    process.env.ENCRYPTION_KEY = "key-one";
    const stored = encryptSecret("secret");
    const flipped = stored.slice(0, -2) + (stored.endsWith("AA") ? "BB" : "AA");
    expect(() => decryptSecret(flipped)).toThrow();
  });

  test("rotation: old key still decrypts via ENCRYPTION_KEY_PREVIOUS, new writes use the new key", () => {
    process.env.ENCRYPTION_KEY = "key-one";
    const old = encryptSecret("secret");
    process.env.ENCRYPTION_KEY = "key-two";
    process.env.ENCRYPTION_KEY_PREVIOUS = "key-one, key-zero";
    expect(decryptSecret(old)).toBe("secret");
    const fresh = encryptSecret("secret");
    delete process.env.ENCRYPTION_KEY_PREVIOUS;
    expect(decryptSecret(fresh)).toBe("secret");
  });

  test("production without ENCRYPTION_KEY refuses to encrypt", () => {
    delete process.env.ENCRYPTION_KEY;
    const nodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      expect(() => encryptSecret("x")).toThrow(/ENCRYPTION_KEY is required/);
    } finally {
      if (nodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = nodeEnv;
    }
  });
});
