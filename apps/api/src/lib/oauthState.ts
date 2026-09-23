import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed, short-lived `state` for the GitHub App install round trip. It binds the callback to the
 * team AND the logged-in user that started it, so a bare teamId (or a state minted by someone else)
 * can't be used to attach an installation to a team.
 */

export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

interface OAuthStatePayload {
  teamId: string;
  userId: string;
  exp: number;
}

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value) throw new Error("SESSION_SECRET is not set");
  return value;
}

function sign(body: string): string {
  return createHmac("sha256", secret()).update(`github-oauth-state:${body}`).digest("base64url");
}

export function createOAuthState(teamId: string, userId: string, now = Date.now()): string {
  const payload: OAuthStatePayload = { teamId, userId, exp: now + OAUTH_STATE_TTL_MS };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function verifyOAuthState(state: string, now = Date.now()): { teamId: string; userId: string } | null {
  const [body, signature, ...rest] = state.split(".");
  if (!body || !signature || rest.length > 0) return null;

  const expected = Buffer.from(sign(body));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<OAuthStatePayload>;
    if (typeof payload.teamId !== "string" || typeof payload.userId !== "string" || typeof payload.exp !== "number") return null;
    if (payload.exp < now) return null;
    return { teamId: payload.teamId, userId: payload.userId };
  } catch {
    return null;
  }
}
