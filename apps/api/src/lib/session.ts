import { eq } from "drizzle-orm";
import { sessions, users, type User } from "@yeah/db";
import { db } from "./db";

export const SESSION_COOKIE = "yeah_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

export async function createSession(userId: string) {
  const id = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessions).values({ id, userId, expiresAt });
  return { id, expiresAt };
}

export async function getUserFromSessionId(sessionId: unknown): Promise<User | null> {
  if (typeof sessionId !== "string" || sessionId.length === 0) return null;
  const rows = await db
    .select({ user: users, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, sessionId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;
  return row.user;
}

export async function destroySession(sessionId: unknown) {
  if (typeof sessionId !== "string" || sessionId.length === 0) return;
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

/** Cookie flags for the session: Secure whenever the panel is served over https (e.g. behind a Cloudflare Tunnel). */
export function sessionCookieOptions(expires: Date) {
  const origin = (process.env.WEB_ORIGIN ?? "").split(",")[0]?.trim() ?? "";
  return { httpOnly: true, sameSite: "lax" as const, secure: origin.startsWith("https://"), path: "/", expires };
}
