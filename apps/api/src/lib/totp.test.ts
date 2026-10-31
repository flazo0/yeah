import { describe, expect, test } from "bun:test";
import { base32Decode, base32Encode, generateRecoveryCodes, hashRecoveryCode, totpAt, verifyTotp } from "./totp";

// RFC 6238 appendix B test secret ("12345678901234567890").
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));

describe("totp", () => {
  test("base32 round-trips", () => {
    expect(RFC_SECRET).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(base32Decode(RFC_SECRET).toString()).toBe("12345678901234567890");
  });
  test("matches the RFC 6238 vectors", () => {
    expect(totpAt(RFC_SECRET, 59_000, 8)).toBe("94287082");
    expect(totpAt(RFC_SECRET, 1111111109_000, 8)).toBe("07081804");
    expect(totpAt(RFC_SECRET, 59_000)).toBe("287082");
  });
  test("verify tolerates one step of drift but not more", () => {
    const now = 1_700_000_000_000;
    const code = totpAt(RFC_SECRET, now);
    expect(verifyTotp(RFC_SECRET, code, now)).toBe(true);
    expect(verifyTotp(RFC_SECRET, code, now + 30_000)).toBe(true);
    expect(verifyTotp(RFC_SECRET, code, now + 120_000)).toBe(false);
    expect(verifyTotp(RFC_SECRET, "abc123", now)).toBe(false);
  });
  test("recovery codes hash case-insensitively", () => {
    const [code] = generateRecoveryCodes(1);
    expect(hashRecoveryCode(code!.toUpperCase())).toBe(hashRecoveryCode(code!));
  });
});
