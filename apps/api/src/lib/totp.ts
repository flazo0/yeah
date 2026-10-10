import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str: string): Buffer {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of str.toUpperCase().replace(/=+$/, "")) {
    const idx = B32.indexOf(ch);
    if (idx === -1) throw new Error("invalid base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** RFC 6238 (HMAC-SHA1, 30s step). */
export function totpAt(secret: string, timeMs: number, digits = 6): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(timeMs / 1000 / 30)));
  const hmac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 15;
  const bin = ((hmac[offset]! & 127) << 24) | (hmac[offset + 1]! << 16) | (hmac[offset + 2]! << 8) | hmac[offset + 3]!;
  return String(bin % 10 ** digits).padStart(digits, "0");
}

/** Accepts the current step and one on each side, to tolerate clock drift. */
export function verifyTotp(secret: string, code: string, nowMs = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  return [-1, 0, 1].some((step) => {
    const expected = Buffer.from(totpAt(secret, nowMs + step * 30_000));
    return timingSafeEqual(expected, Buffer.from(code));
  });
}

export function otpauthUri(secret: string, email: string): string {
  return `otpauth://totp/yeah:${encodeURIComponent(email)}?secret=${secret}&issuer=yeah`;
}

export function generateRecoveryCodes(count = 8): string[] {
  return Array.from({ length: count }, () => randomBytes(5).toString("hex"));
}

export const hashRecoveryCode = (code: string) => createHash("sha256").update(code.trim().toLowerCase()).digest("hex");
