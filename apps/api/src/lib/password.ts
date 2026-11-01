export function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, { algorithm: "argon2id" });
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return Bun.password.verify(password, hash);
}

let dummyHash: Promise<string> | null = null;

/**
 * Verifies against `hash`, or, when there is no account, against a throwaway hash so an unknown e-mail
 * costs as much time as a wrong password (no account enumeration by response time). Always false for no account.
 */
export async function verifyPasswordOrDummy(password: string, hash: string | null | undefined): Promise<boolean> {
  if (hash) return verifyPassword(password, hash);
  dummyHash ??= hashPassword(crypto.randomUUID());
  await verifyPassword(password, await dummyHash);
  return false;
}
