import { Elysia, redirect, t } from "elysia";
import { eq } from "drizzle-orm";
import { githubInstallations, type GithubInstallation } from "@yeah/db";
import type { GithubInstallationDto, GithubRepoDto } from "@yeah/shared";
import { getGithubConfig, getInstallation, getInstallationToken, listInstallationRepos } from "@yeah/github";
import { db } from "../lib/db";
import { getUserFromSessionId, SESSION_COOKIE } from "../lib/session";
import { assertMember } from "../lib/access";
import { createOAuthState, verifyOAuthState } from "../lib/oauthState";

function toInstallationDto(installation: GithubInstallation): GithubInstallationDto {
  return {
    id: installation.id,
    teamId: installation.teamId,
    installationId: installation.installationId,
    accountLogin: installation.accountLogin,
    accountType: installation.accountType,
    createdAt: installation.createdAt.toISOString(),
  };
}

function webOrigin(): string {
  return (process.env.WEB_ORIGIN ?? "http://localhost:5173").split(",")[0]!.trim();
}

export const githubRoutes = new Elysia()
  .get("/teams/:teamId/github", async ({ cookie, params, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    if (!(await assertMember(params.teamId, user.id))) {
      set.status = 403;
      return { error: "forbidden" };
    }

    const rows = await db.select().from(githubInstallations).where(eq(githubInstallations.teamId, params.teamId)).limit(1);
    return { configured: getGithubConfig() !== null, installation: rows[0] ? toInstallationDto(rows[0]) : null };
  })
  .get("/teams/:teamId/github/install-url", async ({ cookie, params, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    if (!(await assertMember(params.teamId, user.id))) {
      set.status = 403;
      return { error: "forbidden" };
    }

    const config = getGithubConfig();
    if (!config) {
      set.status = 400;
      return { error: "GitHub App não configurado neste servidor" };
    }

    // Signed + 10 min expiry + bound to this user (see lib/oauthState.ts) — a bare teamId would let
    // anyone attach an installation they control to that team by hitting the callback directly.
    const state = createOAuthState(params.teamId, user.id);
    return { url: `https://github.com/apps/${config.appSlug}/installations/new?state=${encodeURIComponent(state)}` };
  })
  .get(
    "/github/callback",
    async ({ cookie, query, set }) => {
      const config = getGithubConfig();
      const origin = webOrigin();
      if (!config) {
        set.status = 400;
        return { error: "GitHub App não configurado neste servidor" };
      }

      const { installation_id: installationIdRaw, state } = query;
      if (!installationIdRaw || !state) {
        set.status = 400;
        return { error: "callback inválido — faltam installation_id ou state" };
      }
      const installationId = Number(installationIdRaw);
      if (!Number.isInteger(installationId) || installationId <= 0) {
        set.status = 400;
        return { error: "callback inválido — installation_id" };
      }

      const verified = verifyOAuthState(state);
      if (!verified) {
        set.status = 400;
        return { error: "state inválido ou expirado — volte pra tela do GitHub e clique em conectar de novo" };
      }
      const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
      if (!user || user.id !== verified.userId || !(await assertMember(verified.teamId, user.id))) {
        set.status = 403;
        return { error: "esta conexão foi iniciada por outra sessão — entre na conta certa e tente de novo" };
      }
      const teamId = verified.teamId;

      const info = await getInstallation(config.appId, config.privateKey, installationId);

      await db
        .insert(githubInstallations)
        .values({ teamId, installationId, accountLogin: info.accountLogin, accountType: info.accountType })
        .onConflictDoUpdate({
          target: githubInstallations.teamId,
          set: { installationId, accountLogin: info.accountLogin, accountType: info.accountType },
        });

      return redirect(`${origin}/teams/${teamId}/servers`);
    },
    {
      query: t.Object({
        installation_id: t.Optional(t.String()),
        setup_action: t.Optional(t.String()),
        state: t.Optional(t.String()),
      }),
    },
  )
  .get("/teams/:teamId/github/repos", async ({ cookie, params, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    if (!(await assertMember(params.teamId, user.id))) {
      set.status = 403;
      return { error: "forbidden" };
    }

    const config = getGithubConfig();
    if (!config) {
      set.status = 400;
      return { error: "GitHub App não configurado neste servidor" };
    }

    const rows = await db.select().from(githubInstallations).where(eq(githubInstallations.teamId, params.teamId)).limit(1);
    const installation = rows[0];
    if (!installation) {
      set.status = 404;
      return { error: "nenhuma instalação do GitHub conectada" };
    }

    const { token } = await getInstallationToken(config.appId, config.privateKey, installation.installationId);
    const repos: GithubRepoDto[] = await listInstallationRepos(token);
    return { repos };
  })
  .delete("/teams/:teamId/github", async ({ cookie, params, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    if (!(await assertMember(params.teamId, user.id))) {
      set.status = 403;
      return { error: "forbidden" };
    }

    await db.delete(githubInstallations).where(eq(githubInstallations.teamId, params.teamId));
    return { ok: true };
  });
