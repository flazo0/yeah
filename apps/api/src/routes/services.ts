import { Elysia, t } from "elysia";
import { and, eq } from "drizzle-orm";
import { resourceTags, services, servers, type Service } from "@yeah/db";
import { findServiceCatalogEntry, type ServiceDto } from "@yeah/shared";
import { connectSsh, execStream, shellQuote } from "@yeah/ssh";
import { requireEnvironmentScope } from "../lib/scope";
import { db } from "../lib/db";
import { getUserFromSessionId, SESSION_COOKIE } from "../lib/session";
import { assertMember } from "../lib/access";
import { overloadReason } from "../lib/serverLoad";
import { loadEnvironment } from "../lib/projects";
import { serviceProvisionQueue } from "../lib/queue";

function toServiceDto(service: Service, serverName: string): ServiceDto {
  return {
    id: service.id,
    teamId: service.teamId,
    environmentId: service.environmentId,
    serverId: service.serverId,
    serverName,
    name: service.name,
    catalogKey: service.catalogKey,
    image: service.image,
    port: service.port,
    envContent: service.envContent,
    domain: service.domain,
    memoryLimitMb: service.memoryLimitMb,
    cpuLimit: service.cpuLimit,
    status: service.status,
    createdAt: service.createdAt.toISOString(),
  };
}

async function loadService(environmentId: string, serviceId: string) {
  const rows = await db
    .select({ service: services, serverName: servers.name })
    .from(services)
    .innerJoin(servers, eq(services.serverId, servers.id))
    .where(and(eq(services.id, serviceId), eq(services.environmentId, environmentId)))
    .limit(1);
  return rows[0];
}

export const serviceRoutes = new Elysia({
  prefix: "/teams/:teamId/projects/:projectId/environments/:environmentId/services",
})
  .onBeforeHandle(requireEnvironmentScope)
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
      .select({ service: services, serverName: servers.name })
      .from(services)
      .innerJoin(servers, eq(services.serverId, servers.id))
      .where(eq(services.environmentId, params.environmentId));

    return { services: rows.map((row) => toServiceDto(row.service, row.serverName)) };
  })
  .post(
    "/",
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
      if (!(await loadEnvironment(params.teamId, params.projectId, params.environmentId))) {
        set.status = 404;
        return { error: "environment not found" };
      }

      const catalogEntry = findServiceCatalogEntry(body.catalogKey);
      if (!catalogEntry) {
        set.status = 400;
        return { error: "catalogKey desconhecido" };
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
      const overload = overloadReason(server);
      if (overload && query.force !== "true") {
        set.status = 409;
        return { error: overload, code: "server_overloaded" };
      }

      const [service] = await db
        .insert(services)
        .values({
          teamId: params.teamId,
          environmentId: params.environmentId,
          serverId: body.serverId,
          name: body.name,
          catalogKey: catalogEntry.key,
          image: catalogEntry.image,
          port: body.port ?? catalogEntry.port,
          envContent: catalogEntry.envTemplate,
          memoryLimitMb: body.memoryLimitMb ?? null,
          cpuLimit: body.cpuLimit ?? null,
        })
        .returning();
      if (!service) {
        set.status = 500;
        return { error: "failed to create service" };
      }

      await serviceProvisionQueue.add("provision", { serviceId: service.id });

      return { service: toServiceDto(service, server.name) };
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        serverId: t.String({ minLength: 1 }),
        catalogKey: t.String({ minLength: 1 }),
        port: t.Optional(t.Number()),
        memoryLimitMb: t.Optional(t.Nullable(t.Number())),
        cpuLimit: t.Optional(t.Nullable(t.Number())),
      }),
    },
  )
  .get("/:serviceId", async ({ cookie, params, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    if (!(await assertMember(params.teamId, user.id))) {
      set.status = 403;
      return { error: "forbidden" };
    }

    const row = await loadService(params.environmentId, params.serviceId);
    if (!row) {
      set.status = 404;
      return { error: "service not found" };
    }

    return { service: toServiceDto(row.service, row.serverName) };
  })
  .put(
    "/:serviceId/env",
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

      const row = await loadService(params.environmentId, params.serviceId);
      if (!row) {
        set.status = 404;
        return { error: "service not found" };
      }

      const [updated] = await db
        .update(services)
        .set({ envContent: body.envContent })
        .where(eq(services.id, params.serviceId))
        .returning();
      if (!updated) {
        set.status = 500;
        return { error: "failed to update environment" };
      }

      return { service: toServiceDto(updated, row.serverName) };
    },
    { body: t.Object({ envContent: t.String() }) },
  )
  .put(
    "/:serviceId/domain",
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

      const row = await loadService(params.environmentId, params.serviceId);
      if (!row) {
        set.status = 404;
        return { error: "service not found" };
      }

      const [updated] = await db
        .update(services)
        .set({ domain: body.domain || null })
        .where(eq(services.id, params.serviceId))
        .returning();
      if (!updated) {
        set.status = 500;
        return { error: "failed to update domain" };
      }

      return { service: toServiceDto(updated, row.serverName) };
    },
    { body: t.Object({ domain: t.Optional(t.String()) }) },
  )
  .put(
    "/:serviceId/limits",
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

      const row = await loadService(params.environmentId, params.serviceId);
      if (!row) {
        set.status = 404;
        return { error: "service not found" };
      }

      const [updated] = await db
        .update(services)
        .set({ memoryLimitMb: body.memoryLimitMb ?? null, cpuLimit: body.cpuLimit ?? null })
        .where(eq(services.id, params.serviceId))
        .returning();
      if (!updated) {
        set.status = 500;
        return { error: "failed to update limits" };
      }

      return { service: toServiceDto(updated, row.serverName) };
    },
    { body: t.Object({ memoryLimitMb: t.Optional(t.Nullable(t.Number())), cpuLimit: t.Optional(t.Nullable(t.Number())) }) },
  )
  .post("/:serviceId/redeploy", async ({ cookie, params, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    if (!(await assertMember(params.teamId, user.id))) {
      set.status = 403;
      return { error: "forbidden" };
    }
    if (!(await loadService(params.environmentId, params.serviceId))) {
      set.status = 404;
      return { error: "service not found" };
    }

    await serviceProvisionQueue.add("provision", { serviceId: params.serviceId });
    return { queued: true };
  })
  .delete("/:serviceId", async ({ cookie, params, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    if (!(await assertMember(params.teamId, user.id))) {
      set.status = 403;
      return { error: "forbidden" };
    }

    const row = await loadService(params.environmentId, params.serviceId);
    if (!row) {
      set.status = 404;
      return { error: "service not found" };
    }

    const serverRows = await db.select().from(servers).where(eq(servers.id, row.service.serverId)).limit(1);
    const server = serverRows[0];

    // Deliberate exception to "the API never SSHes directly" (see servers.ts) — same rationale
    // as the application/database teardown-on-delete routes.
    if (server) {
      const containerName = `yeah-svc-${row.service.id}`;
      const volumeName = `${containerName}-data`;
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
            `docker rm -f ${shellQuote(containerName)} >/dev/null 2>&1 || true && ` +
              `docker volume rm ${shellQuote(volumeName)} >/dev/null 2>&1 || true`,
            () => {},
          );
        } finally {
          conn.end();
        }
      } catch (err) {
        console.error(`[api] failed to tear down container for service ${row.service.id}:`, err);
      }
    }

    await db.delete(resourceTags).where(and(eq(resourceTags.resourceType, "service"), eq(resourceTags.resourceId, params.serviceId)));
    await db.delete(services).where(eq(services.id, params.serviceId));
    return { ok: true };
  });
