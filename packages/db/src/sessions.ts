import { eq } from "drizzle-orm";
import type { Db } from "./client";
import { sessions, users, type User } from "./schema";

/** The user behind a session id, or null when it is unknown or expired. Shared by the API and the ws service. */
export async function findSessionUser(db: Db, sessionId: unknown): Promise<User | null> {
  if (typeof sessionId !== "string" || sessionId.length === 0) return null;
  const rows = await db
    .select({ user: users, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, sessionId))
    .limit(1);
  const row = rows[0];
  if (!row || row.expiresAt.getTime() < Date.now()) return null;
  return row.user;
}

/**
 * Like findSessionUser but returns only the user id. It never reads the encrypted user columns, so
 * the ws service can validate sessions without holding the encryption key.
 */
export async function findSessionUserId(db: Db, sessionId: unknown): Promise<string | null> {
  if (typeof sessionId !== "string" || sessionId.length === 0) return null;
  const rows = await db
    .select({ userId: sessions.userId, expiresAt: sessions.expiresAt })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);
  const row = rows[0];
  if (!row || row.expiresAt.getTime() < Date.now()) return null;
  return row.userId;
}
