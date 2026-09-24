import { randomBytes } from "node:crypto";
import { Elysia, t } from "elysia";
import { and, eq } from "drizzle-orm";
import { gitSources, type GitSource } from "@yeah/db";
import {
  GIT_PROVIDERS,
  GIT_PROVIDER_DEFAULT_URL,
  isValidGitBaseUrl,
  normalizeGitBaseUrl,
  parseRepoList,
  repoListRequest,
  type GitProvider,
  type GitSourceDto,
} from "@yeah/shared";
import { db } from "../lib/db";
import { getUserFromSessionId, SESSION_COOKIE } from "../lib/session";
import { assertMember } from "../lib/access";

function isUniqueViolation(err: unknown): boolean {
  const parts: string[] = [];
  for (let e: unknown = err, depth = 0; e && depth < 4; e = (e as { cause?: unknown }).cause, depth++) {
    const { message, code } = e as { message?: string; code?: string };
    parts.push(String(message ?? ""), String(code ?? ""));
  }
  return /23505|unique|duplicate/i.test(parts.join(" "));
}

function toDto(s: GitSource): GitSourceDto {
  return {
    id: s.id,
    provider: s.provider,
    name: s.name,
    baseUrl: s.baseUrl,
    username: s.username,
    hasToken: s.token.length > 0,
    webhookPath: `/webhooks/git/${s.id}`,
    createdAt: s.createdAt.toISOString(),
  };
}

/** Bitbucket Cloud is one fixed service; GitLab defaults to gitlab.com; Gitea has no default. */
function resolveBaseUrl(provider: GitProvider, input: string | undefined): string | null {
  if (provider === "bitbucket") return GIT_PROVIDER_DEFAULT_URL.bitbucket;
  const url = normalizeGitBaseUrl(input || GIT_PROVIDER_DEFAULT_URL[provider] || "");
  return isValidGitBaseUrl(url) ? url : null;
}

export const gitSourceRoutes = new Elysia({ prefix: "/teams/:teamId/git-sources" })
  .get("/", async ({ cookie, params, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    if (!(await assertMember(params.teamId, user.id))) {
      set.status = 403;
      return { error: "forbidden" };
    }
    const rows = await db.select().from(gitSources).where(eq(gitSources.teamId, params.teamId)).orderBy(gitSources.name);
    return { sources: rows.map(toDto) };
  })
  .post(
    "/",
    async ({ cookie, params, body, set }) => {
      const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
      if (!user) {
        set.status = 401;
        return { error: "unauthorized" };
      }
      if (!(await assertMember(params.teamId, user.id))) {
        set.status = 403;
        return { error: "forbidden" };
      }
      if (!GIT_PROVIDERS.includes(body.provider)) {
        set.status = 400;
        return { error: "provedor inválido" };
      }
      const baseUrl = resolveBaseUrl(body.provider, body.baseUrl);
      if (!baseUrl) {
        set.status = 400;
        return { error: "informe a URL do servidor (ex.: https://git.exemplo.com)" };
      }
      if (!body.name.trim() || !body.token) {
        set.status = 400;
        return { error: "informe nome e token" };
      }
      if (body.provider !== "gitlab" && !body.username?.trim()) {
        set.status = 400;
        return { error: "informe o usuário (o Bitbucket usa usuário + senha de app)" };
      }
      try {
        const [row] = await db
          .insert(gitSources)
          .values({
            teamId: params.teamId,
            provider: body.provider,
            name: body.name.trim(),
            baseUrl,
            username: body.username?.trim() ?? "",
            token: body.token,
            webhookSecret: randomBytes(24).toString("hex"),
          })
          .returning();
        return { source: toDto(row!) };
      } catch (err) {
        if (isUniqueViolation(err)) {
          set.status = 409;
          return { error: "já existe uma fonte com esse nome" };
        }
        throw err;
      }
    },
    {
      body: t.Object({
        provider: t.Union([t.Literal("gitlab"), t.Literal("bitbucket"), t.Literal("gitea")]),
        name: t.String({ maxLength: 255 }),
        baseUrl: t.Optional(t.String({ maxLength: 255 })),
        username: t.Optional(t.String({ maxLength: 255 })),
        token: t.String({ maxLength: 4096 }),
      }),
    },
  )
  // The webhook secret is shown only here, on demand — it is the credential the provider's webhook must carry.
  .get("/:sourceId/webhook-secret", async ({ cookie, params, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    if (!(await assertMember(params.teamId, user.id))) {
      set.status = 403;
      return { error: "forbidden" };
    }
    const [row] = await db.select().from(gitSources).where(and(eq(gitSources.id, params.sourceId), eq(gitSources.teamId, params.teamId))).limit(1);
    if (!row) {
      set.status = 404;
      return { error: "source not found" };
    }
    return { secret: row.webhookSecret, path: `/webhooks/git/${row.id}` };
  })
  .get("/:sourceId/repos", async ({ cookie, params, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    if (!(await assertMember(params.teamId, user.id))) {
      set.status = 403;
      return { error: "forbidden" };
    }
    const [row] = await db.select().from(gitSources).where(and(eq(gitSources.id, params.sourceId), eq(gitSources.teamId, params.teamId))).limit(1);
    if (!row) {
      set.status = 404;
      return { error: "source not found" };
    }
    const req = repoListRequest(row.provider, row.baseUrl, row.username, row.token);
    try {
      const res = await fetch(req.url, { headers: { ...req.headers, Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) {
        set.status = 502;
        return { error: `o provedor recusou o token (HTTP ${res.status})` };
      }
      return { repos: parseRepoList(row.provider, await res.json()) };
    } catch (err) {
      set.status = 502;
      return { error: `não consegui falar com o provedor: ${err instanceof Error ? err.message : "erro de rede"}` };
    }
  })
  .delete("/:sourceId", async ({ cookie, params, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    if (!(await assertMember(params.teamId, user.id))) {
      set.status = 403;
      return { error: "forbidden" };
    }
    const deleted = await db.delete(gitSources).where(and(eq(gitSources.id, params.sourceId), eq(gitSources.teamId, params.teamId))).returning({ id: gitSources.id });
    if (deleted.length === 0) {
      set.status = 404;
      return { error: "source not found" };
    }
    // Apps keep their last clone on the server, but their next deploy fails until a source is chosen again (FK set null).
    return { ok: true };
  });
