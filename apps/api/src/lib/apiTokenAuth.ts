import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { apiTokens, type ApiToken } from "@yeah/db";
import { db } from "./db";

/** `yeah_` prefix makes a leaked token recognizable in logs/scanners, same idea as GitHub's `ghp_`. */
export function generateApiToken(): string {
  return `yeah_${randomBytes(32).toString("hex")}`;
}

export function hashApiToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Resolves a `Bearer <token>` Authorization header to its row — null if missing, unknown or expired. */
export async function resolveApiToken(authorizationHeader: string | undefined | null): Promise<ApiToken | null> {
  if (!authorizationHeader?.startsWith("Bearer ")) return null;
  const raw = authorizationHeader.slice("Bearer ".length).trim();
  if (!raw) return null;
  const [token] = await db.select().from(apiTokens).where(eq(apiTokens.tokenHash, hashApiToken(raw))).limit(1);
  if (!token) return null;
  if (token.expiresAt && token.expiresAt.getTime() < Date.now()) return null;
  // Best-effort — a failed write here should never fail the request that's using the token right now.
  void (async () => {
    try {
      await db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, token.id));
    } catch (err) {
      console.error("[api] failed to update api token lastUsedAt:", err);
    }
  })();
  return token;
}
