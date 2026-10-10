import { Elysia, t } from "elysia";
import { and, eq } from "drizzle-orm";
import { apiTokens, type ApiToken } from "@yeah/db";
import type { ApiTokenDto } from "@yeah/shared";
import { db } from "../lib/db";
import { getUserFromSessionId, SESSION_COOKIE } from "../lib/session";
import { assertMember } from "../lib/access";
import { generateApiToken, hashApiToken } from "../lib/apiTokenAuth";

// Personal API tokens (Fase 7) — a thin credential for the CI-only surface in routes/ci.ts. Created
// and listed here under the normal session-cookie auth (same as every other settings screen); only
// the sha256 hash and a short prefix are ever stored, never the raw token itself past the response
// that creates it.

const MAX_EXPIRY_DAYS = 3650;

function toDto(token: ApiToken): ApiTokenDto {
  return {
    id: token.id,
    teamId: token.teamId,
    name: token.name,
    tokenPrefix: token.tokenPrefix,
    permission: token.permission,
    expiresAt: token.expiresAt ? token.expiresAt.toISOString() : null,
    lastUsedAt: token.lastUsedAt ? token.lastUsedAt.toISOString() : null,
    createdAt: token.createdAt.toISOString(),
  };
}

export const apiTokenRoutes = new Elysia({ prefix: "/teams/:teamId/api-tokens" })
  .derive(async ({ cookie, params }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) return { atctx: { error: "unauthorized" as const, status: 401 } };
    if (!(await assertMember(params.teamId, user.id))) return { atctx: { error: "forbidden" as const, status: 403 } };
    return { atctx: { userId: user.id } };
  })
  .get("/", async ({ atctx, params, set }) => {
    if ("error" in atctx) {
      set.status = atctx.status;
      return { error: atctx.error };
    }
    const rows = await db.select().from(apiTokens).where(eq(apiTokens.teamId, params.teamId));
    return { tokens: rows.map(toDto) };
  })
  .post(
    "/",
    async ({ atctx, params, body, set }) => {
      if ("error" in atctx) {
        set.status = atctx.status;
        return { error: atctx.error };
      }
      if (body.expiresInDays !== undefined && (body.expiresInDays < 1 || body.expiresInDays > MAX_EXPIRY_DAYS)) {
        set.status = 400;
        return { error: `expiração entre 1 e ${MAX_EXPIRY_DAYS} dias` };
      }
      const raw = generateApiToken();
      const [token] = await db
        .insert(apiTokens)
        .values({
          teamId: params.teamId,
          createdByUserId: atctx.userId,
          name: body.name,
          tokenHash: hashApiToken(raw),
          tokenPrefix: raw.slice(0, 12),
          permission: body.permission,
          expiresAt: body.expiresInDays ? new Date(Date.now() + body.expiresInDays * 24 * 60 * 60 * 1000) : null,
        })
        .returning();
      if (!token) {
        set.status = 500;
        return { error: "failed to create token" };
      }
      // The only moment the raw token exists outside this process — never logged, never stored.
      return { token: raw, apiToken: toDto(token) };
    },
    { body: t.Object({ name: t.String({ minLength: 1, maxLength: 255 }), permission: t.Union([t.Literal("read"), t.Literal("full")]), expiresInDays: t.Optional(t.Number()) }) },
  )
  .delete("/:tokenId", async ({ atctx, params, set }) => {
    if ("error" in atctx) {
      set.status = atctx.status;
      return { error: atctx.error };
    }
    const [token] = await db.select({ id: apiTokens.id }).from(apiTokens).where(and(eq(apiTokens.id, params.tokenId), eq(apiTokens.teamId, params.teamId))).limit(1);
    if (!token) {
      set.status = 404;
      return { error: "token not found" };
    }
    await db.delete(apiTokens).where(eq(apiTokens.id, token.id));
    return { ok: true };
  });
