import { randomInt } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "./client";
import { sessions, users } from "./schema";

// Lost-password recovery for a single-admin installation: run on the host (`yeah reset-password`), no e-mail needed.

const MIN_PASSWORD_LENGTH = 8;
// no look-alikes (0/O, 1/l/I) so the password can be read off a terminal and typed
const ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateRecoveryPassword(length = 20): string {
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

export interface ResetArgs {
  email: string | null;
  disable2fa: boolean;
  password: string | null;
  error?: string;
}

/** `[email] [--disable-2fa]`, with the new password from YEAH_NEW_PASSWORD (a command-line password would stay in the shell history). */
export function parseResetArgs(argv: string[], env: Record<string, string | undefined>): ResetArgs {
  let email: string | null = null;
  let disable2fa = false;
  for (const arg of argv) {
    if (arg === "--disable-2fa") disable2fa = true;
    else if (arg.startsWith("--")) return { email, disable2fa, password: null, error: `unknown option ${arg}` };
    else if (email === null) email = arg.trim().toLowerCase();
    else return { email, disable2fa, password: null, error: "give at most one e-mail address" };
  }
  const password = env.YEAH_NEW_PASSWORD && env.YEAH_NEW_PASSWORD.length > 0 ? env.YEAH_NEW_PASSWORD : null;
  return { email, disable2fa, password };
}

export type ResetResult = { ok: true; email: string; sessionsEnded: number; twoFactorDisabled: boolean } | { ok: false; error: string };

export async function resetUserPassword(db: Db, input: { email: string | null; password: string; disable2fa: boolean }): Promise<ResetResult> {
  if (input.password.length < MIN_PASSWORD_LENGTH) return { ok: false, error: `the password must be at least ${MIN_PASSWORD_LENGTH} characters` };
  const all = await db.select({ id: users.id, email: users.email }).from(users);
  if (all.length === 0) return { ok: false, error: "there are no accounts yet: open the panel and create the first one" };
  let target = all.find((u) => u.email.toLowerCase() === input.email);
  if (!input.email) {
    if (all.length > 1) return { ok: false, error: `there is more than one account; say which one: ${all.map((u) => u.email).join(", ")}` };
    target = all[0];
  }
  if (!target) return { ok: false, error: `no account with the e-mail ${input.email}` };

  const passwordHash = await Bun.password.hash(input.password, { algorithm: "argon2id" });
  await db
    .update(users)
    .set({ passwordHash, ...(input.disable2fa ? { totpEnabled: false, totpSecret: null, totpRecoveryHashes: null } : {}) })
    .where(eq(users.id, target.id));
  // Anyone signed in with the old password (or a stolen session) is signed out.
  const ended = await db.delete(sessions).where(eq(sessions.userId, target.id)).returning({ id: sessions.id });
  return { ok: true, email: target.email, sessionsEnded: ended.length, twoFactorDisabled: input.disable2fa };
}
