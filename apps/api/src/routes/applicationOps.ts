import { Elysia, t } from "elysia";
import { and, eq } from "drizzle-orm";
import { applications, applicationVolumes, environments, githubInstallations, projects, registries, scheduledTasks, servers } from "@yeah/db";
import {
  buildPackUsesGit,
  isSafeComposeFile,
  isSafePublishDirectory,
  isSshGitUrl,
  isValidComposeService,
  isValidDockerImage,
  isValidRegistryRepository,
} from "@yeah/shared";
import { db } from "../lib/db";
import { getUserFromSessionId, SESSION_COOKIE } from "../lib/session";
import { assertMember } from "../lib/access";
import { tearDownApplication } from "../lib/appTeardown";
import { applicationCopyValues } from "../lib/appCopy";
import { applicationDto, loadApplication } from "./applications";

// Operations on an existing application: change where its code comes from, move it to another
// server, clone it, move it to another environment.

/** True when the environment exists and belongs (through its project) to the team. */
async function environmentInTeam(environmentId: string, teamId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: environments.id })
    .from(environments)
    .innerJoin(projects, eq(environments.projectId, projects.id))
    .where(and(eq(environments.id, environmentId), eq(projects.teamId, teamId)))
    .limit(1);
  return Boolean(row);
}

export const applicationOpsRoutes = new Elysia({
  prefix: "/teams/:teamId/projects/:projectId/environments/:environmentId/applications",
})
  .put(
    "/:applicationId/source",
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
      const row = await loadApplication(params.environmentId, params.applicationId);
      if (!row) {
        set.status = 404;
        return { error: "application not found" };
      }

      const app = row.application;
      const patch: Partial<typeof applications.$inferInsert> = {};

      if (app.buildPack === "image") {
        if (body.dockerImage !== undefined) {
          const image = body.dockerImage.trim();
          if (!isValidDockerImage(image)) {
            set.status = 400;
            return { error: "informe uma imagem válida (ex.: nginx:1.27-alpine ou ghcr.io/org/app:1.0)" };
          }
          patch.dockerImage = image;
          patch.repoUrl = image;
        }
      } else if (app.buildPack === "dockerfile_inline") {
        if (body.dockerfileContent !== undefined) {
          if (!/^\s*(ARG[^\n]*\n\s*)*FROM\s+\S+/im.test(body.dockerfileContent)) {
            set.status = 400;
            return { error: "o Dockerfile precisa ter pelo menos uma instrução FROM" };
          }
          patch.dockerfileContent = body.dockerfileContent;
        }
      } else if (buildPackUsesGit(app.buildPack)) {
        if (body.githubRepo !== undefined) {
          if (body.githubRepo) {
            const [installation] = await db.select().from(githubInstallations).where(eq(githubInstallations.teamId, params.teamId)).limit(1);
            if (!installation) {
              set.status = 400;
              return { error: "nenhuma instalação do GitHub conectada neste time" };
            }
            patch.githubInstallationId = installation.installationId;
            patch.githubRepo = body.githubRepo;
            patch.repoUrl = `https://github.com/${body.githubRepo}`;
          } else {
            // Unlinking from GitHub: the app needs a plain URL from now on.
            if (!body.repoUrl?.trim()) {
              set.status = 400;
              return { error: "ao desligar do GitHub, informe a URL do repositório" };
            }
            patch.githubInstallationId = null;
            patch.githubRepo = null;
          }
        }
        if (body.repoUrl !== undefined && body.githubRepo === undefined) {
          const url = body.repoUrl.trim();
          if (!url) {
            set.status = 400;
            return { error: "informe a URL do repositório" };
          }
          if (app.githubRepo) {
            set.status = 400;
            return { error: "esta aplicação usa o GitHub App — troque o repositório escolhendo outro do GitHub" };
          }
          patch.repoUrl = url;
        } else if (body.repoUrl !== undefined && body.githubRepo === "") {
          patch.repoUrl = body.repoUrl.trim();
        }
        if (patch.repoUrl && app.deployKey && !isSshGitUrl(patch.repoUrl)) {
          set.status = 400;
          return { error: "deploy key só funciona com URL SSH (git@host:org/repo.git ou ssh://...)" };
        }
        if (body.branch !== undefined) {
          const branch = body.branch.trim();
          if (!branch || /[\s~^:?*\[\\]/.test(branch) || branch.startsWith("-")) {
            set.status = 400;
            return { error: "branch inválida" };
          }
          patch.branch = branch;
        }
        if (app.buildPack === "static" && body.publishDirectory !== undefined) {
          const dir = body.publishDirectory.trim() || ".";
          if (!isSafePublishDirectory(dir)) {
            set.status = 400;
            return { error: "a pasta publicada precisa ser um caminho relativo simples dentro do repositório" };
          }
          patch.publishDirectory = dir;
        }
        if (app.buildPack === "docker_compose") {
          if (body.composeFile !== undefined) {
            const file = body.composeFile.trim();
            if (!isSafeComposeFile(file)) {
              set.status = 400;
              return { error: "o arquivo compose precisa ser um caminho relativo simples dentro do repositório" };
            }
            patch.composeFile = file;
          }
          if (body.composeService !== undefined) {
            const service = body.composeService.trim();
            if (service && !isValidComposeService(service)) {
              set.status = 400;
              return { error: "nome de serviço do compose inválido" };
            }
            patch.composeService = service || null;
          }
        }
      }

      if (body.port !== undefined) {
        if (!Number.isInteger(body.port) || body.port < 1 || body.port > 65535) {
          set.status = 400;
          return { error: "porta inválida" };
        }
        patch.port = body.port;
      }

      if (Object.keys(patch).length === 0) return { application: await applicationDto(app, row.serverName) };
      const [updated] = await db.update(applications).set(patch).where(eq(applications.id, app.id)).returning();
      return { application: await applicationDto(updated ?? app, row.serverName) };
    },
    {
      body: t.Object({
        repoUrl: t.Optional(t.String({ maxLength: 1000 })),
        branch: t.Optional(t.String({ maxLength: 255 })),
        githubRepo: t.Optional(t.String({ maxLength: 255 })),
        dockerImage: t.Optional(t.String({ maxLength: 512 })),
        dockerfileContent: t.Optional(t.String({ maxLength: 100000 })),
        publishDirectory: t.Optional(t.String({ maxLength: 255 })),
        composeFile: t.Optional(t.String({ maxLength: 255 })),
        composeService: t.Optional(t.String({ maxLength: 64 })),
        port: t.Optional(t.Number()),
      }),
    },
  )
  .put(
    "/:applicationId/server",
    async ({ cookie, params, body, query, set }) => {
      const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
      if (!user) {
        set.status = 401;
        return { error: "unauthorized" };
      }
      if (!(await assertMember(params.teamId, user.id))) {
        set.status = 403;
        return { error: "forbidden" };
      }
      const row = await loadApplication(params.environmentId, params.applicationId);
      if (!row) {
        set.status = 404;
        return { error: "application not found" };
      }

      const app = row.application;
      if (app.status === "deploying") {
        set.status = 409;
        return { error: "há um deploy em andamento — espere terminar" };
      }
      if (body.serverId === app.serverId) {
        set.status = 400;
        return { error: "a aplicação já está nesse servidor" };
      }
      const [target] = await db.select().from(servers).where(and(eq(servers.id, body.serverId), eq(servers.teamId, params.teamId))).limit(1);
      if (!target) {
        set.status = 404;
        return { error: "servidor de destino não encontrado" };
      }
      if (target.status !== "connected") {
        set.status = 409;
        return { error: "o servidor de destino não está conectado" };
      }

      // Take it off the old server first, so two copies never run at once.
      const [oldServer] = await db.select().from(servers).where(eq(servers.id, app.serverId)).limit(1);
      if (oldServer) {
        const volumes = await db.select().from(applicationVolumes).where(eq(applicationVolumes.applicationId, app.id));
        const failure = await tearDownApplication(app, oldServer, volumes);
        if (failure && query.force !== "true") {
          set.status = 502;
          return { error: `não consegui limpar o servidor antigo (${failure}). Tente de novo, ou confirme pra mover mesmo assim — o container antigo fica lá.`, code: "teardown_failed" };
        }
      }
      const [updated] = await db
        .update(applications)
        .set({ serverId: target.id, status: "idle", deployedConfig: null })
        .where(eq(applications.id, app.id))
        .returning();
      return { application: await applicationDto(updated ?? app, target.name) };
    },
    { body: t.Object({ serverId: t.String() }) },
  )
  .post(
    "/:applicationId/clone",
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
      const row = await loadApplication(params.environmentId, params.applicationId);
      if (!row) {
        set.status = 404;
        return { error: "application not found" };
      }

      const app = row.application;
      const environmentId = body.environmentId ?? app.environmentId;
      if (!(await environmentInTeam(environmentId, params.teamId))) {
        set.status = 404;
        return { error: "ambiente de destino não encontrado" };
      }
      const serverId = body.serverId ?? app.serverId;
      const [target] = await db.select().from(servers).where(and(eq(servers.id, serverId), eq(servers.teamId, params.teamId))).limit(1);
      if (!target) {
        set.status = 404;
        return { error: "servidor de destino não encontrado" };
      }
      const name = (body.name ?? `${app.name}-copia`).trim();
      if (!name) {
        set.status = 400;
        return { error: "informe um nome" };
      }

      const [copy] = await db.insert(applications).values(applicationCopyValues(app, { name, environmentId, serverId })).returning();
      if (!copy) {
        set.status = 500;
        return { error: "falha ao clonar" };
      }
      const volumes = await db.select().from(applicationVolumes).where(eq(applicationVolumes.applicationId, app.id));
      if (volumes.length) await db.insert(applicationVolumes).values(volumes.map((v) => ({ applicationId: copy.id, name: v.name, mountPath: v.mountPath, kind: v.kind, hostPath: v.hostPath, fileContent: v.fileContent })));
      // Scheduled tasks come along paused: the copy should not start running jobs before someone checks it.
      const tasks = await db.select().from(scheduledTasks).where(eq(scheduledTasks.applicationId, app.id));
      if (tasks.length) {
        await db.insert(scheduledTasks).values(
          tasks.map((task) => ({ applicationId: copy.id, name: task.name, command: task.command, cron: task.cron, timezone: task.timezone, timeoutSeconds: task.timeoutSeconds, enabled: false })),
        );
      }
      return { application: await applicationDto(copy, target.name), environmentId };
    },
    { body: t.Object({ name: t.Optional(t.String({ maxLength: 255 })), environmentId: t.Optional(t.String()), serverId: t.Optional(t.String()) }) },
  )
  .put(
    "/:applicationId/preview",
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
      const row = await loadApplication(params.environmentId, params.applicationId);
      if (!row) {
        set.status = 404;
        return { error: "application not found" };
      }
      const app = row.application;
      if (app.previewOfId) {
        set.status = 400;
        return { error: "um preview não tem previews próprios" };
      }
      if (body.enabled) {
        if (!app.githubRepo || !app.githubInstallationId) {
          set.status = 400;
          return { error: "previews só funcionam em aplicações ligadas a um repositório do GitHub (GitHub App)" };
        }
        const [server] = await db.select().from(servers).where(eq(servers.id, app.serverId)).limit(1);
        if (!server || server.proxyStatus !== "active" || !server.wildcardDomain) {
          set.status = 409;
          return { error: "cada preview ganha um domínio próprio: o servidor precisa de proxy ativo e domínio wildcard configurado" };
        }
      }
      const [updated] = await db.update(applications).set({ previewEnabled: body.enabled }).where(eq(applications.id, app.id)).returning();
      return { application: await applicationDto(updated ?? app, row.serverName) };
    },
    { body: t.Object({ enabled: t.Boolean() }) },
  )
  .get("/:applicationId/previews", async ({ cookie, params, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    if (!(await assertMember(params.teamId, user.id))) {
      set.status = 403;
      return { error: "forbidden" };
    }
    const row = await loadApplication(params.environmentId, params.applicationId);
    if (!row) {
      set.status = 404;
      return { error: "application not found" };
    }
    const previews = await db.select().from(applications).where(eq(applications.previewOfId, row.application.id));
    return { previews: previews.map((p) => ({ id: p.id, name: p.name, prNumber: p.prNumber, branch: p.branch, domain: p.domain, status: p.status, createdAt: p.createdAt.toISOString() })) };
  })
  .put(
    "/:applicationId/registry",
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
      const row = await loadApplication(params.environmentId, params.applicationId);
      if (!row) {
        set.status = 404;
        return { error: "application not found" };
      }
      const app = row.application;
      if (app.buildPack === "docker_compose") {
        set.status = 400;
        return { error: "aplicações Docker Compose não usam o registry do painel (use o docker login do próprio compose)" };
      }
      if (!body.registryId) {
        const [updated] = await db.update(applications).set({ registryId: null, registryImage: null }).where(eq(applications.id, app.id)).returning();
        return { application: await applicationDto(updated ?? app, row.serverName) };
      }
      const [registry] = await db.select().from(registries).where(and(eq(registries.id, body.registryId), eq(registries.teamId, params.teamId))).limit(1);
      if (!registry) {
        set.status = 404;
        return { error: "registry não encontrado" };
      }
      let repository: string | null = null;
      if (app.buildPack !== "image") {
        repository = (body.repository ?? "").trim();
        if (!isValidRegistryRepository(repository)) {
          set.status = 400;
          return { error: "informe o repositório onde a imagem será enviada, em minúsculas (ex.: minha-org/minha-app)" };
        }
      }
      const [updated] = await db.update(applications).set({ registryId: registry.id, registryImage: repository }).where(eq(applications.id, app.id)).returning();
      return { application: await applicationDto(updated ?? app, row.serverName) };
    },
    { body: t.Object({ registryId: t.Nullable(t.String()), repository: t.Optional(t.String({ maxLength: 255 })) }) },
  )
  .put(
    "/:applicationId/move",
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
      const row = await loadApplication(params.environmentId, params.applicationId);
      if (!row) {
        set.status = 404;
        return { error: "application not found" };
      }

      const app = row.application;
      if (body.environmentId === app.environmentId) {
        set.status = 400;
        return { error: "a aplicação já está nesse ambiente" };
      }
      if (!(await environmentInTeam(body.environmentId, params.teamId))) {
        set.status = 404;
        return { error: "ambiente de destino não encontrado" };
      }
      const [updated] = await db.update(applications).set({ environmentId: body.environmentId }).where(eq(applications.id, app.id)).returning();
      return { application: await applicationDto(updated ?? app, row.serverName) };
    },
    { body: t.Object({ environmentId: t.String() }) },
  );
