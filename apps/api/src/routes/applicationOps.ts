import { Elysia, t } from "elysia";
import { and, eq } from "drizzle-orm";
import { applications, applicationVolumes, environments, githubInstallations, gitSources, projects, registries, scheduledTasks, servers } from "@yeah/db";
import {
  buildPackUsesGit,
  isSafeComposeFile,
  isSafePublishDirectory,
  isSshGitUrl,
  isValidComposeService,
  isValidDockerImage,
  isValidRegistryRepository,
  isValidGitRepoPath,
  gitRepoUrl,
} from "@yeah/shared";
import { requireEnvironmentScope } from "../lib/scope";
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
  .onBeforeHandle(requireEnvironmentScope)
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
            return { error: "provide a valid image (e.g. nginx:1.27-alpine or ghcr.io/org/app:1.0)" };
          }
          patch.dockerImage = image;
          patch.repoUrl = image;
        }
      } else if (app.buildPack === "dockerfile_inline") {
        if (body.dockerfileContent !== undefined) {
          if (!/^\s*(ARG[^\n]*\n\s*)*FROM\s+\S+/im.test(body.dockerfileContent)) {
            set.status = 400;
            return { error: "the Dockerfile needs at least one FROM instruction" };
          }
          patch.dockerfileContent = body.dockerfileContent;
        }
      } else if (buildPackUsesGit(app.buildPack)) {
        if (body.githubRepo !== undefined) {
          if (body.githubRepo) {
            const [installation] = await db.select().from(githubInstallations).where(eq(githubInstallations.teamId, params.teamId)).limit(1);
            if (!installation) {
              set.status = 400;
              return { error: "no GitHub installation connected to this team" };
            }
            patch.githubInstallationId = installation.installationId;
            patch.githubRepo = body.githubRepo;
            patch.repoUrl = `https://github.com/${body.githubRepo}`;
          } else {
            // Unlinking from GitHub: the app needs a plain URL from now on.
            if (!body.repoUrl?.trim()) {
              set.status = 400;
              return { error: "when disconnecting from GitHub, provide the repository URL" };
            }
            patch.githubInstallationId = null;
            patch.githubRepo = null;
          }
        }
        if (app.gitSourceId && body.gitRepo !== undefined) {
          if (!isValidGitRepoPath(body.gitRepo)) {
            set.status = 400;
            return { error: "provide the repository as group/project" };
          }
          const [source] = await db.select().from(gitSources).where(eq(gitSources.id, app.gitSourceId)).limit(1);
          if (!source) {
            set.status = 400;
            return { error: "this application's Git source was removed" };
          }
          patch.gitRepo = body.gitRepo;
          patch.repoUrl = gitRepoUrl(source.baseUrl, body.gitRepo);
        }
        if (body.repoUrl !== undefined && body.githubRepo === undefined && body.gitRepo === undefined) {
          const url = body.repoUrl.trim();
          if (!url) {
            set.status = 400;
            return { error: "provide the repository URL" };
          }
          if (app.githubRepo || app.gitSourceId) {
            set.status = 400;
            return { error: "this application comes from a connected source — change the repository by picking another one from it" };
          }
          patch.repoUrl = url;
        } else if (body.repoUrl !== undefined && body.githubRepo === "") {
          patch.repoUrl = body.repoUrl.trim();
        }
        if (patch.repoUrl && app.deployKey && !isSshGitUrl(patch.repoUrl)) {
          set.status = 400;
          return { error: "a deploy key only works with an SSH URL (git@host:org/repo.git ou ssh://...)" };
        }
        if (body.branch !== undefined) {
          const branch = body.branch.trim();
          if (!branch || /[\s~^:?*\[\\]/.test(branch) || branch.startsWith("-")) {
            set.status = 400;
            return { error: "invalid branch" };
          }
          patch.branch = branch;
        }
        if (app.buildPack === "static" && body.publishDirectory !== undefined) {
          const dir = body.publishDirectory.trim() || ".";
          if (!isSafePublishDirectory(dir)) {
            set.status = 400;
            return { error: "the publish directory must be a simple relative path inside the repository" };
          }
          patch.publishDirectory = dir;
        }
        if (app.buildPack === "static" && body.staticSpa !== undefined) {
          patch.staticSpa = body.staticSpa;
        }
        if (app.buildPack === "docker_compose") {
          if (body.composeFile !== undefined) {
            const file = body.composeFile.trim();
            if (!isSafeComposeFile(file)) {
              set.status = 400;
              return { error: "the compose file must be a simple relative path inside the repository" };
            }
            patch.composeFile = file;
          }
          if (body.composeService !== undefined) {
            const service = body.composeService.trim();
            if (service && !isValidComposeService(service)) {
              set.status = 400;
              return { error: "invalid compose service name" };
            }
            patch.composeService = service || null;
          }
        }
      }

      if (body.port !== undefined) {
        if (!Number.isInteger(body.port) || body.port < 1 || body.port > 65535) {
          set.status = 400;
          return { error: "invalid port" };
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
        gitRepo: t.Optional(t.String({ maxLength: 255 })),
        dockerImage: t.Optional(t.String({ maxLength: 512 })),
        dockerfileContent: t.Optional(t.String({ maxLength: 100000 })),
        publishDirectory: t.Optional(t.String({ maxLength: 255 })),
        staticSpa: t.Optional(t.Boolean()),
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
        return { error: "a deployment is in progress — wait for it to finish" };
      }
      if (body.serverId === app.serverId) {
        set.status = 400;
        return { error: "the application is already on that server" };
      }
      const [target] = await db.select().from(servers).where(and(eq(servers.id, body.serverId), eq(servers.teamId, params.teamId))).limit(1);
      if (!target) {
        set.status = 404;
        return { error: "destination server not found" };
      }
      if (target.status !== "connected") {
        set.status = 409;
        return { error: "the destination server is not connected" };
      }

      // Take it off the old server first, so two copies never run at once.
      const [oldServer] = await db.select().from(servers).where(eq(servers.id, app.serverId)).limit(1);
      if (oldServer) {
        const volumes = await db.select().from(applicationVolumes).where(eq(applicationVolumes.applicationId, app.id));
        const failure = await tearDownApplication(app, oldServer, volumes);
        if (failure && query.force !== "true") {
          set.status = 502;
          return { error: `could not clean up the old server (${failure}). Try again, or confirm to move anyway — the old container stays there.`, code: "teardown_failed" };
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
        return { error: "destination environment not found" };
      }
      const serverId = body.serverId ?? app.serverId;
      const [target] = await db.select().from(servers).where(and(eq(servers.id, serverId), eq(servers.teamId, params.teamId))).limit(1);
      if (!target) {
        set.status = 404;
        return { error: "destination server not found" };
      }
      const name = (body.name ?? `${app.name}-copy`).trim();
      if (!name) {
        set.status = 400;
        return { error: "informe um nome" };
      }

      const [copy] = await db.insert(applications).values(applicationCopyValues(app, { name, environmentId, serverId })).returning();
      if (!copy) {
        set.status = 500;
        return { error: "clone failed" };
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
        return { error: "a preview cannot have previews of its own" };
      }
      if (body.enabled) {
        if (!app.githubRepo || !app.githubInstallationId) {
          set.status = 400;
          return { error: "previews only work for applications linked to a GitHub repository (GitHub App)" };
        }
        const [server] = await db.select().from(servers).where(eq(servers.id, app.serverId)).limit(1);
        if (!server || server.proxyStatus !== "active" || !server.wildcardDomain) {
          set.status = 409;
          return { error: "each preview gets its own domain: the server needs an active proxy and a wildcard domain configured" };
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
        return { error: "Docker Compose applications do not use the panel's registry (use docker login inside the compose file)" };
      }
      if (!body.registryId) {
        // A build server needs the registry to hand off the built image — clearing one clears the other.
        const [updated] = await db.update(applications).set({ registryId: null, registryImage: null, buildServerId: null }).where(eq(applications.id, app.id)).returning();
        return { application: await applicationDto(updated ?? app, row.serverName) };
      }
      const [registry] = await db.select().from(registries).where(and(eq(registries.id, body.registryId), eq(registries.teamId, params.teamId))).limit(1);
      if (!registry) {
        set.status = 404;
        return { error: "registry not found" };
      }
      let repository: string | null = null;
      if (app.buildPack !== "image") {
        repository = (body.repository ?? "").trim();
        if (!isValidRegistryRepository(repository)) {
          set.status = 400;
          return { error: "provide the repository the image will be pushed to, in lowercase (e.g. my-org/my-app)" };
        }
      }
      const [updated] = await db.update(applications).set({ registryId: registry.id, registryImage: repository }).where(eq(applications.id, app.id)).returning();
      return { application: await applicationDto(updated ?? app, row.serverName) };
    },
    { body: t.Object({ registryId: t.Nullable(t.String()), repository: t.Optional(t.String({ maxLength: 255 })) }) },
  )
  // Separates where the image is built from where it runs: build_server_id builds+pushes, server_id
  // (above) only ever pulls. Requires a registry + image already set (see /registry above) — that's
  // the only way the built image gets from one server to the other.
  .put(
    "/:applicationId/build-server",
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
      if (!body.buildServerId) {
        const [updated] = await db.update(applications).set({ buildServerId: null }).where(eq(applications.id, app.id)).returning();
        return { application: await applicationDto(updated ?? app, row.serverName) };
      }
      if (app.buildPack === "image" || app.buildPack === "docker_compose") {
        set.status = 400;
        return { error: "a build server only applies to build packs that build an image from the repository (not image or docker_compose)" };
      }
      if (!app.registryId || !app.registryImage) {
        set.status = 400;
        return { error: "configure a registry and the image repository first (Source tab) — that is how the built image reaches the deploy server" };
      }
      const [buildServer] = await db.select().from(servers).where(and(eq(servers.id, body.buildServerId), eq(servers.teamId, params.teamId))).limit(1);
      if (!buildServer) {
        set.status = 404;
        return { error: "server not found" };
      }
      const [updated] = await db.update(applications).set({ buildServerId: buildServer.id }).where(eq(applications.id, app.id)).returning();
      return { application: await applicationDto(updated ?? app, row.serverName) };
    },
    { body: t.Object({ buildServerId: t.Nullable(t.String()) }) },
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
        return { error: "the application is already in that environment" };
      }
      if (!(await environmentInTeam(body.environmentId, params.teamId))) {
        set.status = 404;
        return { error: "destination environment not found" };
      }
      const [updated] = await db.update(applications).set({ environmentId: body.environmentId }).where(eq(applications.id, app.id)).returning();
      return { application: await applicationDto(updated ?? app, row.serverName) };
    },
    { body: t.Object({ environmentId: t.String() }) },
  );
