import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { customType } from "drizzle-orm/pg-core";

/**
 * AES-256-GCM envelope for every secret stored in Postgres (SSH private keys, database passwords,
 * S3 secret keys, SMTP password, webhook URLs, .env contents).
 *
 * Stored form: `enc:v1:` + base64url(iv[12] | authTag[16] | ciphertext). The version prefix lets
 * a future scheme coexist with this one, and lets legacy plaintext rows (written before this
 * existed) be told apart from encrypted ones — decrypt() passes those through untouched until
 * encryptExistingSecrets() rewrites them.
 *
 * Keys: ENCRYPTION_KEY encrypts. Decryption tries ENCRYPTION_KEY first and then every entry of
 * ENCRYPTION_KEY_PREVIOUS (comma-separated), so a key can be rotated by moving the old value there.
 */

const PREFIX = "enc:v1:";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const DEV_FALLBACK_KEY = "yeah-dev-only-encryption-key-do-not-use-in-production";

function deriveKey(secret: string): Buffer {
  return createHmac("sha256", "yeah:encryption:v1").update(secret).digest();
}

let cache: { signature: string; current: Buffer; all: Buffer[] } | null = null;

function keyring(): { current: Buffer; all: Buffer[] } {
  const primary = process.env.ENCRYPTION_KEY?.trim();
  const previous = (process.env.ENCRYPTION_KEY_PREVIOUS ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  const signature = `${primary ?? ""}|${previous.join(",")}`;
  if (cache && cache.signature === signature) return cache;

  let current: string;
  if (primary) {
    current = primary;
  } else if (process.env.NODE_ENV === "production") {
    throw new Error("ENCRYPTION_KEY is required in production — set it in .env (any long random string).");
  } else {
    current = DEV_FALLBACK_KEY;
  }
  const all = [current, ...previous].map(deriveKey);
  cache = { signature, current: all[0]!, all };
  return cache;
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}

export function encryptSecret(plaintext: string): string {
  const { current } = keyring();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", current, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ciphertext]).toString("base64url");
}

export function decryptSecret(stored: string): string {
  if (!isEncrypted(stored)) return stored;
  const raw = Buffer.from(stored.slice(PREFIX.length), "base64url");
  if (raw.length < IV_BYTES + TAG_BYTES) throw new Error("encrypted value is truncated");
  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = raw.subarray(IV_BYTES + TAG_BYTES);
  for (const key of keyring().all) {
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    } catch {
      // wrong key or tampered data — try the next key
    }
  }
  throw new Error("cannot decrypt stored secret — ENCRYPTION_KEY does not match the one it was encrypted with");
}

/** Drop-in `text` column that encrypts on write and decrypts on read — callers never see ciphertext. */
export const encryptedText = customType<{ data: string; driverData: string }>({
  dataType() {
    return "text";
  },
  toDriver(value) {
    return value == null ? value : encryptSecret(value);
  },
  fromDriver(value) {
    return value == null ? value : decryptSecret(value);
  },
});
