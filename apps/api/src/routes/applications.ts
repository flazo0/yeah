import { Elysia, t } from "elysia";
import { and, desc, eq } from "drizzle-orm";
import {
  applications,
  applicationVolumes,
  scheduledTaskExecutions,
  scheduledTasks,
  type ScheduledTask,
  deployments,
  githubInstallations,
  servers,
  type Application,
  type ApplicationVolume,
  type Deployment,
  resourceTags,
} from "@yeah/db";
import type { ApplicationDto, ApplicationLifecycleAction, ApplicationVolumeDto, DeploymentDto, ScheduledTaskDto, ScheduledTaskExecutionDto } from "@yeah/shared";
import { buildPackUsesGit, isSafePublishDirectory, isSshGitUrl, isValidDockerImage, volumeName, type BuildPack } from "@yeah/shared";
import { connectSsh, execStream, generateSshKeyPair, shellQuote } from "@yeah/ssh";
import { db } from "../lib/db";
import { getUserFromSessionId, SESSION_COOKIE } from "../lib/session";
import { assertMember } from "../lib/access";
import { overloadReason } from "../lib/serverLoad";
import { loadEnvironment } from "../lib/projects";
import { applicationDeployQueue, applicationLifecycleQueue, scheduledTaskQueue } from "../lib/queue";
import { addScheduledTask, removeScheduledTask } from "@yeah/queue";
import { generateDeployToken, hashDeployToken, validateAdvancedSettings } from "../lib/deployRules";

function toApplicationDto(app: Application, serverName: string): ApplicationDto {
  return {
    id: app.id,
    teamId: app.teamId,
    environmentId: app.environmentId,
    serverId: app.serverId,
    serverName,
    name: app.name,
    repoUrl: app.repoUrl,
    branch: app.branch,
    buildPack: app.buildPack,
    dockerImage: app.dockerImage,
    dockerfileContent: app.dockerfileContent,
    publishDirectory: app.publishDirectory,
    deployKeyPublic: app.deployKeyPublic,
    port: app.port,
    envContent: app.envContent,
    domain: app.domain,
    githubRepo: app.githubRepo,
    healthPath: app.healthPath,
    healthIntervalSeconds: app.healthIntervalSeconds,
    healthTimeoutSeconds: app.healthTimeoutSeconds,
    healthRetries: app.healthRetries,
    healthStartPeriodSeconds: app.healthStartPeriodSeconds,
    dockerOptions: app.dockerOptions,
    stopGraceSeconds: app.stopGraceSeconds,
    hasDeployToken: Boolean(app.deployTokenHash),
    memoryLimitMb: app.memoryLimitMb,
    cpuLimit: app.cpuLimit,
    status: app.status,
    createdAt: app.createdAt.toISOString(),
  };
}

function toTaskDto(task: ScheduledTask, last: { status: "running" | "success" | "failed"; startedAt: Date; finishedAt: Date | null } | undefined): ScheduledTaskDto {
  return {
    id: task.id,
    applicationId: task.applicationId,
    name: task.name,
    command: task.command,
    cron: task.cron,
    timezone: task.timezone,
    timeoutSeconds: task.timeoutSeconds,
    enabled: task.enabled,
    createdAt: task.createdAt.toISOString(),
    lastExecution: last ? { status: last.status, startedAt: last.startedAt.toISOString(), finishedAt: last.finishedAt ? last.finishedAt.toISOString() : null } : null,
  };
}

function toDeploymentDto(deployment: Deployment): DeploymentDto {
  return {
    id: deployment.id,
    applicationId: deployment.applicationId,
    status: deployment.status,
    log: deployment.log,
    commitSha: deployment.commitSha,
    startedAt: deployment.startedAt ? deployment.startedAt.toISOString() : null,
    finishedAt: deployment.finishedAt ? deployment.finishedAt.toISOString() : null,
    createdAt: deployment.createdAt.toISOString(),
  };
}

function toVolumeDto(volume: ApplicationVolume): ApplicationVolumeDto {
  return {
    id: volume.id,
    applicationId: volume.applicationId,
    name: volume.name,
    mountPath: volume.mountPath,
    createdAt: volume.createdAt.toISOString(),
  };
}

async function loadApplication(environmentId: string, applicationId: string) {
  const rows = await db
    .select({ application: applications, serverName: servers.name })
    .from(applications)
    .innerJoin(servers, eq(applications.serverId, servers.id))
    .where(and(eq(applications.id, applicationId), eq(applications.environmentId, environmentId)))
    .limit(1);
  return rows[0];
}

export const applicationRoutes = new Elysia({
  prefix: "/teams/:teamId/projects/:projectId/environments/:environmentId/applications",
})
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
    if (!(await loadEnvironment(params.teamId, params.projectId, params.environmentId))) {
      set.status = 404;
      return { error: "environment not found" };
    }

    const rows = await db
      .select({ application: applications, serverName: servers.name })
      .from(applications)
      .innerJoin(servers, eq(applications.serverId, servers.id))
      .where(eq(applications.environmentId, params.environmentId));

    return { applications: rows.map((row) => toApplicationDto(row.application, row.serverName)) };
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
      if (!(await loadEnvironment(params.teamId, params.projectId, params.environmentId))) {
        set.status = 404;
        return { error: "environment not found" };
      }

      const serverRows = await db
        .select()
        .from(servers)
        .where(and(eq(servers.id, body.serverId), eq(servers.teamId, params.teamId)))
        .limit(1);
      const server = serverRows[0];
      if (!server) {
        set.status = 404;
        return { error: "server not found" };
      }

      const buildPack = (body.buildPack ?? "dockerfile") as BuildPack;
      let repoUrl = body.repoUrl ?? "";
      let githubInstallationId: number | null = null;
      let port = body.port ?? 3000;
      let dockerImage: string | null = null;
      let dockerfileContent: string | null = null;
      let publishDirectory = ".";
      let deployKey: string | null = null;
      let deployKeyPublic: string | null = null;

      if (buildPack === "image") {
        const image = body.dockerImage?.trim() ?? "";
        if (!isValidDockerImage(image)) {
          set.status = 400;
          return { error: "informe uma imagem válida (ex.: nginx:1.27-alpine ou ghcr.io/org/app:1.0)" };
        }
        dockerImage = image;
        repoUrl = image;
      } else if (buildPack === "dockerfile_inline") {
        const content = body.dockerfileContent ?? "";
        if (!/^\s*(ARG[^\n]*\n\s*)*FROM\s+\S+/im.test(content)) {
          set.status = 400;
          return { error: "o Dockerfile precisa ter pelo menos uma instrução FROM" };
        }
        dockerfileContent = content;
        repoUrl = "(Dockerfile)";
      } else {
        // dockerfile / static / nixpacks: all start from a Git repository.
        if (body.githubRepo) {
          const installationRows = await db
            .select()
            .from(githubInstallations)
            .where(eq(githubInstallations.teamId, params.teamId))
            .limit(1);
          const installation = installationRows[0];
          if (!installation) {
            set.status = 400;
            return { error: "nenhuma instalação do GitHub conectada neste time" };
          }
          githubInstallationId = installation.installationId;
          repoUrl = `https://github.com/${body.githubRepo}`;
        }
        if (!repoUrl) {
          set.status = 400;
          return { error: "informe repoUrl ou githubRepo" };
        }
        if (body.useDeployKey) {
          if (!isSshGitUrl(repoUrl)) {
            set.status = 400;
            return { error: "deploy key só funciona com URL SSH (git@host:org/repo.git ou ssh://...)" };
          }
          const pair = generateSshKeyPair(`yeah-deploy-${body.name}`);
          deployKey = pair.privateKey;
          deployKeyPublic = pair.publicKey;
        }
        if (buildPack === "static") {
          publishDirectory = (body.publishDirectory ?? ".").trim() || ".";
          if (!isSafePublishDirectory(publishDirectory)) {
            set.status = 400;
            return { error: "a pasta publicada precisa ser um caminho relativo simples dentro do repositório" };
          }
          port = 80;
        }
      }
      if (!buildPackUsesGit(buildPack) && body.githubRepo) {
        set.status = 400;
        return { error: "githubRepo só vale pra aplicações a partir de um repositório Git" };
      }

      const [application] = await db
        .insert(applications)
        .values({
          teamId: params.teamId,
          environmentId: params.environmentId,
          serverId: body.serverId,
          name: body.name,
          repoUrl,
          branch: body.branch ?? "main",
          buildPack,
          dockerImage,
          dockerfileContent,
          publishDirectory,
          deployKey,
          deployKeyPublic,
          port,
          githubInstallationId,
          githubRepo: body.githubRepo ?? null,
          memoryLimitMb: body.memoryLimitMb ?? null,
          cpuLimit: body.cpuLimit ?? null,
        })
        .returning();
      if (!application) {
        set.status = 500;
        return { error: "failed to create application" };
      }

      return { application: toApplicationDto(application, server.name) };
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        serverId: t.String({ minLength: 1 }),
        buildPack: t.Optional(t.Union([t.Literal("dockerfile"), t.Literal("static"), t.Literal("nixpacks"), t.Literal("image"), t.Literal("dockerfile_inline")])),
        dockerImage: t.Optional(t.String({ maxLength: 512 })),
        dockerfileContent: t.Optional(t.String({ maxLength: 100000 })),
        publishDirectory: t.Optional(t.String({ maxLength: 255 })),
        useDeployKey: t.Optional(t.Boolean()),
        repoUrl: t.Optional(t.String()),
        githubRepo: t.Optional(t.String()),
        branch: t.Optional(t.String()),
        port: t.Optional(t.Number()),
        memoryLimitMb: t.Optional(t.Nullable(t.Number())),
        cpuLimit: t.Optional(t.Nullable(t.Number())),
      }),
    },
  )
  .get("/:applicationId", async ({ cookie, params, set }) => {
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

    return { application: toApplicationDto(row.application, row.serverName) };
  })
  .put(
    "/:applicationId/env",
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

      const [updated] = await db
        .update(applications)
        .set({ envContent: body.envContent })
        .where(eq(applications.id, params.applicationId))
        .returning();
      if (!updated) {
        set.status = 500;
        return { error: "failed to update environment" };
      }

      return { application: toApplicationDto(updated, row.serverName) };
    },
    { body: t.Object({ envContent: t.String() }) },
  )
  .put(
    "/:applicationId/domain",
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

      const [updated] = await db
        .update(applications)
        .set({ domain: body.domain || null })
        .where(eq(applications.id, params.applicationId))
        .returning();
      if (!updated) {
        set.status = 500;
        return { error: "failed to update domain" };
      }

      return { application: toApplicationDto(updated, row.serverName) };
    },
    { body: t.Object({ domain: t.Optional(t.String()) }) },
  )
  .put(
    "/:applicationId/limits",
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

      const [updated] = await db
        .update(applications)
        .set({ memoryLimitMb: body.memoryLimitMb ?? null, cpuLimit: body.cpuLimit ?? null })
        .where(eq(applications.id, params.applicationId))
        .returning();
      if (!updated) {
        set.status = 500;
        return { error: "failed to update limits" };
      }

      return { application: toApplicationDto(updated, row.serverName) };
    },
    { body: t.Object({ memoryLimitMb: t.Optional(t.Nullable(t.Number())), cpuLimit: t.Optional(t.Nullable(t.Number())) }) },
  )
  .put(
    "/:applicationId/advanced",
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

      const error = validateAdvancedSettings(body);
      if (error) {
        set.status = 400;
        return { error };
      }

      const [updated] = await db
        .update(applications)
        .set({
          healthPath: body.healthPath?.trim() || null,
          healthIntervalSeconds: body.healthIntervalSeconds,
          healthTimeoutSeconds: body.healthTimeoutSeconds,
          healthRetries: body.healthRetries,
          healthStartPeriodSeconds: body.healthStartPeriodSeconds,
          dockerOptions: body.dockerOptions,
          stopGraceSeconds: body.stopGraceSeconds,
        })
        .where(eq(applications.id, params.applicationId))
        .returning();
      if (!updated) {
        set.status = 500;
        return { error: "failed to update advanced settings" };
      }
      return { application: toApplicationDto(updated, row.serverName) };
    },
    {
      body: t.Object({
        healthPath: t.Optional(t.Nullable(t.String({ maxLength: 255 }))),
        healthIntervalSeconds: t.Number(),
        healthTimeoutSeconds: t.Number(),
        healthRetries: t.Number(),
        healthStartPeriodSeconds: t.Number(),
        dockerOptions: t.String({ maxLength: 4000 }),
        stopGraceSeconds: t.Number(),
      }),
    },
  )
  .post(
    "/:applicationId/lifecycle",
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

      if (row.application.status === "deploying") {
        set.status = 409;
        return { error: "aguarde o deploy em andamento terminar" };
      }
      await applicationLifecycleQueue.add("lifecycle", { applicationId: params.applicationId, action: body.action as ApplicationLifecycleAction });
      return { queued: true };
    },
    { body: t.Object({ action: t.Union([t.Literal("start"), t.Literal("stop"), t.Literal("restart")]) }) },
  )
  // Recent output of the running container. One of the narrow places the API opens SSH itself (like
  // teardown on delete): a bounded, read-only `docker logs --tail`, polled by the Logs tab.
  .get("/:applicationId/logs", async ({ cookie, params, query, set }) => {
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

      const tail = Math.min(2000, Math.max(1, Number(query.tail) || 300));
      const [server] = await db.select().from(servers).where(eq(servers.id, row.application.serverId)).limit(1);
      if (!server) {
        set.status = 404;
        return { error: "server not found" };
      }
      let conn: Awaited<ReturnType<typeof connectSsh>> | null = null;
      try {
        conn = await connectSsh({ host: server.host, port: server.port, username: server.sshUser, privateKey: server.privateKey, timeoutMs: server.sshTimeoutSeconds * 1000 });
        let output = "";
        const result = await execStream(conn, `docker logs --tail ${tail} --timestamps ${shellQuote(`yeah-app-${row.application.id}`)} 2>&1`, (chunk) => {
          output += chunk;
        });
        if (result.exitCode !== 0) return { logs: "", running: false, message: output.trim() || "container não encontrado — faça um deploy primeiro" };
        return { logs: output, running: true };
      } catch (err) {
        set.status = 502;
        return { error: err instanceof Error ? err.message : "falha ao ler os logs" };
      } finally {
        conn?.end();
      }
    })
  // The token is shown exactly once, here; only its hash is stored.
  .post("/:applicationId/deploy-token", async ({ cookie, params, set }) => {
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

      const token = generateDeployToken();
      await db.update(applications).set({ deployTokenHash: hashDeployToken(token) }).where(eq(applications.id, params.applicationId));
      return { token };
    })
  .delete("/:applicationId/deploy-token", async ({ cookie, params, set }) => {
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

      await db.update(applications).set({ deployTokenHash: null }).where(eq(applications.id, params.applicationId));
      return { ok: true };
    })
  .get("/:applicationId/tasks", async ({ cookie, params, set }) => {
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

      const tasks = await db.select().from(scheduledTasks).where(eq(scheduledTasks.applicationId, params.applicationId));
      const result: ScheduledTaskDto[] = [];
      for (const task of tasks) {
        const [last] = await db
          .select()
          .from(scheduledTaskExecutions)
          .where(eq(scheduledTaskExecutions.taskId, task.id))
          .orderBy(desc(scheduledTaskExecutions.startedAt))
          .limit(1);
        result.push(toTaskDto(task, last));
      }
      return { tasks: result };
    })
  .post(
    "/:applicationId/tasks",
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

      const timeout = body.timeoutSeconds ?? 300;
      if (!Number.isInteger(timeout) || timeout < 1 || timeout > 86400) {
        set.status = 400;
        return { error: "o limite de tempo precisa ser de 1 a 86400 segundos" };
      }
      const [task] = await db
        .insert(scheduledTasks)
        .values({
          applicationId: params.applicationId,
          name: body.name,
          command: body.command,
          cron: body.cron.trim(),
          timezone: body.timezone ?? "UTC",
          timeoutSeconds: timeout,
          enabled: body.enabled ?? true,
        })
        .returning();
      if (!task) {
        set.status = 500;
        return { error: "failed to create task" };
      }
      try {
        if (task.enabled) await addScheduledTask(scheduledTaskQueue, task.id, task.cron, task.timezone);
      } catch (err) {
        // BullMQ rejects a malformed cron expression or an unknown timezone — undo the row.
        await db.delete(scheduledTasks).where(eq(scheduledTasks.id, task.id));
        set.status = 400;
        return { error: `agendamento inválido: ${err instanceof Error ? err.message : "cron ou timezone"}` };
      }
      return { task: toTaskDto(task, undefined) };
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 255 }),
        command: t.String({ minLength: 1, maxLength: 4000 }),
        cron: t.String({ minLength: 1, maxLength: 100 }),
        timezone: t.Optional(t.String({ maxLength: 100 })),
        timeoutSeconds: t.Optional(t.Number()),
        enabled: t.Optional(t.Boolean()),
      }),
    },
  )
  .put(
    "/:applicationId/tasks/:taskId",
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

      const [task] = await db
        .select()
        .from(scheduledTasks)
        .where(and(eq(scheduledTasks.id, params.taskId), eq(scheduledTasks.applicationId, params.applicationId)))
        .limit(1);
      if (!task) {
        set.status = 404;
        return { error: "task not found" };
      }

      const timeout = body.timeoutSeconds ?? task.timeoutSeconds;
      if (!Number.isInteger(timeout) || timeout < 1 || timeout > 86400) {
        set.status = 400;
        return { error: "o limite de tempo precisa ser de 1 a 86400 segundos" };
      }
      const next = {
        name: body.name,
        command: body.command,
        cron: body.cron.trim(),
        timezone: body.timezone ?? task.timezone,
        timeoutSeconds: timeout,
        enabled: body.enabled ?? task.enabled,
      };
      try {
        if (next.enabled) await addScheduledTask(scheduledTaskQueue, task.id, next.cron, next.timezone);
        else await removeScheduledTask(scheduledTaskQueue, task.id);
      } catch (err) {
        set.status = 400;
        return { error: `agendamento inválido: ${err instanceof Error ? err.message : "cron ou timezone"}` };
      }
      const [updated] = await db.update(scheduledTasks).set(next).where(eq(scheduledTasks.id, task.id)).returning();
      return { task: toTaskDto(updated ?? task, undefined) };
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 255 }),
        command: t.String({ minLength: 1, maxLength: 4000 }),
        cron: t.String({ minLength: 1, maxLength: 100 }),
        timezone: t.Optional(t.String({ maxLength: 100 })),
        timeoutSeconds: t.Optional(t.Number()),
        enabled: t.Optional(t.Boolean()),
      }),
    },
  )
  .delete("/:applicationId/tasks/:taskId", async ({ cookie, params, set }) => {
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

      const [task] = await db
        .select()
        .from(scheduledTasks)
        .where(and(eq(scheduledTasks.id, params.taskId), eq(scheduledTasks.applicationId, params.applicationId)))
        .limit(1);
      if (!task) {
        set.status = 404;
        return { error: "task not found" };
      }

      await removeScheduledTask(scheduledTaskQueue, task.id);
      await db.delete(scheduledTasks).where(eq(scheduledTasks.id, task.id));
      return { ok: true };
    })
  .post("/:applicationId/tasks/:taskId/run", async ({ cookie, params, set }) => {
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

      const [task] = await db
        .select()
        .from(scheduledTasks)
        .where(and(eq(scheduledTasks.id, params.taskId), eq(scheduledTasks.applicationId, params.applicationId)))
        .limit(1);
      if (!task) {
        set.status = 404;
        return { error: "task not found" };
      }

      await scheduledTaskQueue.add("run", { taskId: task.id, manual: true });
      return { queued: true };
    })
  .get("/:applicationId/tasks/:taskId/executions", async ({ cookie, params, set }) => {
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

      const [task] = await db
        .select()
        .from(scheduledTasks)
        .where(and(eq(scheduledTasks.id, params.taskId), eq(scheduledTasks.applicationId, params.applicationId)))
        .limit(1);
      if (!task) {
        set.status = 404;
        return { error: "task not found" };
      }

      const rows = await db
        .select()
        .from(scheduledTaskExecutions)
        .where(eq(scheduledTaskExecutions.taskId, task.id))
        .orderBy(desc(scheduledTaskExecutions.startedAt))
        .limit(50);
      const executions: ScheduledTaskExecutionDto[] = rows.map((e) => ({
        id: e.id,
        taskId: e.taskId,
        status: e.status,
        log: e.log,
        exitCode: e.exitCode,
        manual: e.manual,
        startedAt: e.startedAt.toISOString(),
        finishedAt: e.finishedAt ? e.finishedAt.toISOString() : null,
      }));
      return { executions };
    })
  .get("/:applicationId/volumes", async ({ cookie, params, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    if (!(await assertMember(params.teamId, user.id))) {
      set.status = 403;
      return { error: "forbidden" };
    }
    if (!(await loadApplication(params.environmentId, params.applicationId))) {
      set.status = 404;
      return { error: "application not found" };
    }

    const rows = await db
      .select()
      .from(applicationVolumes)
      .where(eq(applicationVolumes.applicationId, params.applicationId));

    return { volumes: rows.map(toVolumeDto) };
  })
  .post(
    "/:applicationId/volumes",
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
      if (!(await loadApplication(params.environmentId, params.applicationId))) {
        set.status = 404;
        return { error: "application not found" };
      }
      if (!body.mountPath.startsWith("/")) {
        set.status = 400;
        return { error: "mountPath precisa ser um caminho absoluto (começar com /)" };
      }

      const [volume] = await db
        .insert(applicationVolumes)
        .values({ applicationId: params.applicationId, name: body.name, mountPath: body.mountPath })
        .returning();
      if (!volume) {
        set.status = 500;
        return { error: "failed to create volume" };
      }

      return { volume: toVolumeDto(volume) };
    },
    { body: t.Object({ name: t.String({ minLength: 1 }), mountPath: t.String({ minLength: 1 }) }) },
  )
  .delete("/:applicationId/volumes/:volumeId", async ({ cookie, params, set }) => {
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

    const volumeRows = await db
      .select()
      .from(applicationVolumes)
      .where(and(eq(applicationVolumes.id, params.volumeId), eq(applicationVolumes.applicationId, params.applicationId)))
      .limit(1);
    const volume = volumeRows[0];
    if (!volume) {
      set.status = 404;
      return { error: "volume not found" };
    }

    await db.delete(applicationVolumes).where(eq(applicationVolumes.id, params.volumeId));

    // Same deliberate exception as the application-teardown route below: a bounded, synchronous
    // best-effort cleanup the browser is waiting on. Fails silently if the container still has it
    // mounted (removed for real on the next deploy, which stops passing the -v flag) or the server
    // is unreachable — the row is already gone either way, which is what the user asked for.
    const serverRows = await db.select().from(servers).where(eq(servers.id, row.application.serverId)).limit(1);
    const server = serverRows[0];
    if (server) {
      try {
        const conn = await connectSsh({ host: server.host, port: server.port, username: server.sshUser, privateKey: server.privateKey, timeoutMs: server.sshTimeoutSeconds * 1000 });
        try {
          await execStream(conn, `docker volume rm ${shellQuote(volumeName(volume.id))} >/dev/null 2>&1 || true`, () => {});
        } finally {
          conn.end();
        }
      } catch (err) {
        console.error(`[api] failed to remove docker volume for application volume ${volume.id}:`, err);
      }
    }

    return { ok: true };
  })
  .get("/:applicationId/deployments", async ({ cookie, params, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    if (!(await assertMember(params.teamId, user.id))) {
      set.status = 403;
      return { error: "forbidden" };
    }
    if (!(await loadApplication(params.environmentId, params.applicationId))) {
      set.status = 404;
      return { error: "application not found" };
    }

    const rows = await db
      .select()
      .from(deployments)
      .where(eq(deployments.applicationId, params.applicationId))
      .orderBy(desc(deployments.createdAt))
      .limit(20);

    return { deployments: rows.map(toDeploymentDto) };
  })
  .get("/:applicationId/deployments/:deploymentId", async ({ cookie, params, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    if (!(await assertMember(params.teamId, user.id))) {
      set.status = 403;
      return { error: "forbidden" };
    }
    if (!(await loadApplication(params.environmentId, params.applicationId))) {
      set.status = 404;
      return { error: "application not found" };
    }

    const rows = await db
      .select()
      .from(deployments)
      .where(and(eq(deployments.id, params.deploymentId), eq(deployments.applicationId, params.applicationId)))
      .limit(1);
    const deployment = rows[0];
    if (!deployment) {
      set.status = 404;
      return { error: "deployment not found" };
    }

    return { deployment: toDeploymentDto(deployment) };
  })
  .post("/:applicationId/deploy", async ({ cookie, params, query, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    if (!(await assertMember(params.teamId, user.id))) {
      set.status = 403;
      return { error: "forbidden" };
    }
    const found = await loadApplication(params.environmentId, params.applicationId);
    if (!found) {
      set.status = 404;
      return { error: "application not found" };
    }
    const [targetServer] = await db.select().from(servers).where(eq(servers.id, found.application.serverId)).limit(1);
    const overload = targetServer ? overloadReason(targetServer) : null;
    if (overload && query.force !== "true") {
      set.status = 409;
      return { error: overload, code: "server_overloaded" };
    }

    const [deployment] = await db
      .insert(deployments)
      .values({ applicationId: params.applicationId, status: "queued" })
      .returning();
    if (!deployment) {
      set.status = 500;
      return { error: "failed to create deployment" };
    }

    await applicationDeployQueue.add("deploy", { deploymentId: deployment.id });

    return { deployment: toDeploymentDto(deployment) };
  })
  .post("/:applicationId/deployments/:deploymentId/rollback", async ({ cookie, params, query, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    if (!(await assertMember(params.teamId, user.id))) {
      set.status = 403;
      return { error: "forbidden" };
    }
    const found = await loadApplication(params.environmentId, params.applicationId);
    if (!found) {
      set.status = 404;
      return { error: "application not found" };
    }
    const [targetServer] = await db.select().from(servers).where(eq(servers.id, found.application.serverId)).limit(1);
    const overload = targetServer ? overloadReason(targetServer) : null;
    if (overload && query.force !== "true") {
      set.status = 409;
      return { error: overload, code: "server_overloaded" };
    }

    const targetRows = await db
      .select()
      .from(deployments)
      .where(and(eq(deployments.id, params.deploymentId), eq(deployments.applicationId, params.applicationId)))
      .limit(1);
    const target = targetRows[0];
    if (!target) {
      set.status = 404;
      return { error: "deployment not found" };
    }
    if (target.status !== "success" || !target.commitSha) {
      set.status = 400;
      return { error: "só dá pra voltar pra um deploy que terminou com sucesso" };
    }

    // Pre-filling commitSha is the entire rollback mechanism — the worker checks this field before
    // pulling the branch and, if set, checks out that exact commit instead. See deployApplication.ts.
    const [deployment] = await db
      .insert(deployments)
      .values({ applicationId: params.applicationId, status: "queued", commitSha: target.commitSha })
      .returning();
    if (!deployment) {
      set.status = 500;
      return { error: "failed to create deployment" };
    }

    await applicationDeployQueue.add("deploy", { deploymentId: deployment.id });

    return { deployment: toDeploymentDto(deployment) };
  })
  .delete("/:applicationId", async ({ cookie, params, set }) => {
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

    const serverRows = await db.select().from(servers).where(eq(servers.id, row.application.serverId)).limit(1);
    const server = serverRows[0];
    const volumeRows = await db.select().from(applicationVolumes).where(eq(applicationVolumes.applicationId, row.application.id));

    // Deliberate exception to "the API never SSHes directly" (see servers.ts): a bounded,
    // synchronous teardown the browser is waiting on — same rationale as the backup download route.
    if (server) {
      const containerName = `yeah-app-${row.application.id}`;
      const appDir = `/opt/yeah-apps/${row.application.id}`;
      const volumeRmCommand = volumeRows.map((v) => `docker volume rm ${shellQuote(volumeName(v.id))} >/dev/null 2>&1 || true`).join(" && ");
      try {
        const conn = await connectSsh({
          host: server.host,
          port: server.port,
          username: server.sshUser,
          privateKey: server.privateKey,
        timeoutMs: server.sshTimeoutSeconds * 1000,
        });
        try {
          await execStream(
            conn,
            `docker rm -f ${shellQuote(containerName)} >/dev/null 2>&1 || true && rm -rf ${shellQuote(appDir)} >/dev/null 2>&1 || true` +
              (volumeRmCommand ? ` && ${volumeRmCommand}` : ""),
            () => {},
          );
        } finally {
          conn.end();
        }
      } catch (err) {
        console.error(`[api] failed to tear down container for application ${row.application.id}:`, err);
      }
    }

    // Cascade removes the task rows, but their cron schedulers live in Redis and would keep ticking.
    const taskRows = await db.select({ id: scheduledTasks.id }).from(scheduledTasks).where(eq(scheduledTasks.applicationId, params.applicationId));
    for (const task of taskRows) await removeScheduledTask(scheduledTaskQueue, task.id).catch(() => undefined);

    await db.delete(resourceTags).where(and(eq(resourceTags.resourceType, "application"), eq(resourceTags.resourceId, params.applicationId)));
    await db.delete(applications).where(eq(applications.id, params.applicationId));

    return { ok: true };
  });
