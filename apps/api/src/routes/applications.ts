import { Elysia, t } from "elysia";
import { and, desc, eq } from "drizzle-orm";
import {
  applications,
  applicationVolumes,
  deployments,
  githubInstallations,
  servers,
  type Application,
  type ApplicationVolume,
  type Deployment,
} from "@yeah/db";
import type { ApplicationDto, ApplicationVolumeDto, DeploymentDto } from "@yeah/shared";
import { volumeName } from "@yeah/shared";
import { connectSsh, execStream, shellQuote } from "@yeah/ssh";
import { db } from "../lib/db";
import { getUserFromSessionId, SESSION_COOKIE } from "../lib/session";
import { assertMember } from "../lib/access";
import { overloadReason } from "../lib/serverLoad";
import { loadEnvironment } from "../lib/projects";
import { applicationDeployQueue } from "../lib/queue";

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
    port: app.port,
    envContent: app.envContent,
    domain: app.domain,
    githubRepo: app.githubRepo,
    memoryLimitMb: app.memoryLimitMb,
    cpuLimit: app.cpuLimit,
    status: app.status,
    createdAt: app.createdAt.toISOString(),
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

      let repoUrl = body.repoUrl;
      let githubInstallationId: number | null = null;
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

      const [application] = await db
        .insert(applications)
        .values({
          teamId: params.teamId,
          environmentId: params.environmentId,
          serverId: body.serverId,
          name: body.name,
          repoUrl,
          branch: body.branch ?? "main",
          port: body.port ?? 3000,
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
        const conn = await connectSsh({ host: server.host, port: server.port, username: server.sshUser, privateKey: server.privateKey });
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

    await db.delete(applications).where(eq(applications.id, params.applicationId));

    return { ok: true };
  });
