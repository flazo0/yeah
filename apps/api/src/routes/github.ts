import { Elysia, redirect, t } from "elysia";
import { eq } from "drizzle-orm";
import { githubInstallations, type GithubInstallation } from "@yeah/db";
import type { GithubInstallationDto, GithubRepoDto } from "@yeah/shared";
import { getGithubConfig, getInstallation, getInstallationToken, listInstallationRepos } from "@yeah/github";
import { db } from "../lib/db";
import { getUserFromSessionId, SESSION_COOKIE } from "../lib/session";
import { assertMember } from "../lib/access";

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

    // TODO(security): `state` should be a signed, short-lived token before this goes to
    // production — a bare teamId lets anyone who knows/guesses it attach an installation
    // they control to that team by hitting the callback URL directly.
    return { url: `https://github.com/apps/${config.appSlug}/installations/new?state=${params.teamId}` };
  })
  .get(
    "/github/callback",
    async ({ query, set }) => {
      const config = getGithubConfig();
      const origin = webOrigin();
      if (!config) {
        set.status = 400;
        return { error: "GitHub App não configurado neste servidor" };
      }

      const { installation_id: installationIdRaw, state: teamId } = query;
      if (!installationIdRaw || !teamId) {
        set.status = 400;
        return { error: "callback inválido — faltam installation_id ou state" };
      }
      const installationId = Number(installationIdRaw);

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
