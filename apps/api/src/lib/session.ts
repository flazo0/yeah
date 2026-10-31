import { eq } from "drizzle-orm";
import { findSessionUser, sessions, type User } from "@yeah/db";
import { db } from "./db";

// The cookie name lives in @yeah/shared so the ws service reads the very same one.
export { SESSION_COOKIE } from "@yeah/shared";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

export async function createSession(userId: string) {
  const id = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessions).values({ id, userId, expiresAt });
  return { id, expiresAt };
}

/** Session lookup shared with the ws service (see findSessionUser in @yeah/db). */
export function getUserFromSessionId(sessionId: unknown): Promise<User | null> {
  return findSessionUser(db, sessionId);
}

export async function destroySession(sessionId: unknown) {
  if (typeof sessionId !== "string" || sessionId.length === 0) return;
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

/**
 * Cookie flags for the session: Secure whenever the panel is served over https — configured that way in WEB_ORIGIN
 * (e.g. behind a Cloudflare Tunnel) or reached that way right now (the panel's own domain). `requestOrigin` is the
 * Origin header of the sign-in request: a visit over plain http, still possible by IP, must not get a Secure cookie.
 */
export function sessionCookieOptions(expires: Date, requestOrigin?: string | null) {
  const configured = (process.env.WEB_ORIGIN ?? "").split(",")[0]?.trim() ?? "";
  const secure = configured.startsWith("https://") || (requestOrigin ?? "").startsWith("https://");
  return { httpOnly: true, sameSite: "lax" as const, secure, path: "/", expires };
}
