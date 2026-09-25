import { Elysia, t } from "elysia";
import { and, eq } from "drizzle-orm";
import { resourceTags, services, servers, volumeBackups, type Service } from "@yeah/db";
import { composeLogsCommand, composeProjectName, composeTeardownCommand, findServiceCatalogEntry, normalizeHost, parseComposeStack, validateStackDomains, type ServiceContainerDto, type ServiceDto, type StackDomain } from "@yeah/shared";
import { connectSsh, execStream, shellQuote } from "@yeah/ssh";
import { requireEnvironmentScope } from "../lib/scope";
import { db } from "../lib/db";
import { getUserFromSessionId, SESSION_COOKIE } from "../lib/session";
import { assertMember } from "../lib/access";
import { overloadReason } from "../lib/serverLoad";
import { loadEnvironment } from "../lib/projects";
import { serviceProvisionQueue } from "../lib/queue";
import { claimedHosts } from "../lib/hosts";
import { findTemplate, renderTemplateEnv } from "../lib/templates";

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
    composeContent: service.composeContent,
    templateKey: service.templateKey,
    mainService: service.mainService,
    domains: service.domains,
    stackServices: (() => {
      if (!service.composeContent) return [];
      const parsed = parseComposeStack(service.composeContent);
      return parsed.ok ? Object.keys(parsed.services) : [];
    })(),
    lastLog: service.lastLog,
    memoryLimitMb: service.memoryLimitMb,
    cpuLimit: service.cpuLimit,
    status: service.status,
    createdAt: service.createdAt.toISOString(),
  };
}

export async function loadService(environmentId: string, serviceId: string) {
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

      const sources = [body.catalogKey, body.templateKey, body.composeContent].filter((v) => v !== undefined).length;
      if (sources !== 1) {
        set.status = 400;
        return { error: "informe exatamente uma origem: catalogKey, templateKey ou composeContent" };
      }
      const catalogEntry = body.catalogKey ? findServiceCatalogEntry(body.catalogKey) : undefined;
      if (body.catalogKey && !catalogEntry) {
        set.status = 400;
        return { error: "catalogKey desconhecido" };
      }
      const template = body.templateKey ? findTemplate(body.templateKey) : undefined;
      if (body.templateKey && !template) {
        set.status = 400;
        return { error: "template desconhecido" };
      }
      let stack: { composeContent: string; envContent: string; templateKey: string | null; mainService: string; port: number; image: string } | null = null;
      if (template) {
        const parsedTemplate = parseComposeStack(template.compose);
        stack = {
          composeContent: template.compose,
          envContent: renderTemplateEnv(template),
          templateKey: template.key,
          mainService: template.mainService,
          port: body.port ?? template.port,
          image: parsedTemplate.ok ? String(parsedTemplate.services[template.mainService]?.image ?? "") : "",
        };
      } else if (body.composeContent !== undefined) {
        const parsed = parseComposeStack(body.composeContent);
        if (!parsed.ok) {
          set.status = 400;
          return { error: parsed.error };
        }
        const first = Object.keys(parsed.services)[0]!;
        stack = { composeContent: body.composeContent, envContent: body.envContent ?? "", templateKey: null, mainService: first, port: body.port ?? 80, image: String(parsed.services[first]?.image ?? "") };
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
          catalogKey: stack ? (stack.templateKey ? `template:${stack.templateKey}` : "custom") : catalogEntry!.key,
          image: stack ? stack.image : catalogEntry!.image,
          port: stack ? stack.port : (body.port ?? catalogEntry!.port),
          envContent: stack ? stack.envContent : catalogEntry!.envTemplate,
          composeContent: stack?.composeContent ?? null,
          templateKey: stack?.templateKey ?? null,
          mainService: stack?.mainService ?? null,
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
        catalogKey: t.Optional(t.String({ minLength: 1 })),
        templateKey: t.Optional(t.String({ minLength: 1 })),
        composeContent: t.Optional(t.String({ maxLength: 200000 })),
        envContent: t.Optional(t.String({ maxLength: 100000 })),
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
  .put(
    "/:serviceId/compose",
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
      if (!row.service.composeContent) {
        set.status = 400;
        return { error: "este serviço é de um container só (catálogo antigo) e não tem compose" };
      }
      const parsed = parseComposeStack(body.composeContent);
      if (!parsed.ok) {
        set.status = 400;
        return { error: parsed.error };
      }
      const names = Object.keys(parsed.services);
      // Domains and the main service must still point at services that exist.
      const domains = row.service.domains.filter((d) => names.includes(d.service));
      const mainService = row.service.mainService && names.includes(row.service.mainService) ? row.service.mainService : names[0]!;
      const [updated] = await db
        .update(services)
        .set({ composeContent: body.composeContent, ...(body.envContent !== undefined ? { envContent: body.envContent } : {}), domains, mainService })
        .where(eq(services.id, row.service.id))
        .returning();
      return { service: toServiceDto(updated ?? row.service, row.serverName) };
    },
    { body: t.Object({ composeContent: t.String({ maxLength: 200000 }), envContent: t.Optional(t.String({ maxLength: 100000 })) }) },
  )
  .put(
    "/:serviceId/domains",
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
      if (!row.service.composeContent) {
        set.status = 400;
        return { error: "domínios por container só existem em stacks — use a aba Geral neste serviço" };
      }
      const parsed = parseComposeStack(row.service.composeContent);
      const names = parsed.ok ? Object.keys(parsed.services) : [];
      const domains: StackDomain[] = body.domains.map((d) => ({ service: d.service, domain: normalizeHost(d.domain), port: d.port }));
      const invalid = validateStackDomains(domains, names);
      if (invalid) {
        set.status = 400;
        return { error: invalid };
      }
      const claimed = await claimedHosts(params.teamId, row.service.id);
      for (const d of domains) {
        const owner = claimed.get(d.domain);
        if (owner) {
          set.status = 409;
          return { error: `o domínio ${d.domain} já é usado por ${owner}` };
        }
      }
      const [updated] = await db.update(services).set({ domains }).where(eq(services.id, row.service.id)).returning();
      return { service: toServiceDto(updated ?? row.service, row.serverName) };
    },
    { body: t.Object({ domains: t.Array(t.Object({ service: t.String(), domain: t.String(), port: t.Number() })) }) },
  )
  .get("/:serviceId/containers", async ({ cookie, params, set }) => {
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
    if (!row.service.composeContent) return { containers: [] as ServiceContainerDto[] };
    const [server] = await db.select().from(servers).where(eq(servers.id, row.service.serverId)).limit(1);
    if (!server) {
      set.status = 404;
      return { error: "server not found" };
    }
    // Same short live read as the application logs route.
    let conn: Awaited<ReturnType<typeof connectSsh>> | null = null;
    try {
      conn = await connectSsh({ host: server.host, port: server.port, username: server.sshUser, privateKey: server.privateKey, timeoutMs: server.sshTimeoutSeconds * 1000 });
      let output = "";
      await execStream(
        conn,
        `docker ps -a --filter ${shellQuote(`label=com.docker.compose.project=${`yeah-svc-${row.service.id}`}`)} --format '{{json .}}'`,
        (chunk) => {
          output += chunk;
        },
      );
      const containers: ServiceContainerDto[] = [];
      for (const line of output.split("\n")) {
        if (!line.trim().startsWith("{")) continue;
        try {
          const r = JSON.parse(line) as { Names: string; Image: string; State: string; Status: string; Labels: string };
          const service = /(?:^|,)com\.docker\.compose\.service=([^,]+)/.exec(r.Labels)?.[1] ?? "";
          containers.push({ name: r.Names, service, image: r.Image, state: r.State, status: r.Status });
        } catch {
          /* skip a garbled line */
        }
      }
      return { containers };
    } catch (err) {
      set.status = 502;
      return { error: err instanceof Error ? err.message : "falha ao listar os containers" };
    } finally {
      conn?.end();
    }
  })
  .get("/:serviceId/logs", async ({ cookie, params, query, set }) => {
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
    if (!row.service.composeContent) {
      set.status = 400;
      return { error: "logs só existem em stacks" };
    }
    const [server] = await db.select().from(servers).where(eq(servers.id, row.service.serverId)).limit(1);
    if (!server) {
      set.status = 404;
      return { error: "server not found" };
    }
    const tail = Math.min(2000, Math.max(1, Number(query.tail) || 300));
    let conn: Awaited<ReturnType<typeof connectSsh>> | null = null;
    try {
      conn = await connectSsh({ host: server.host, port: server.port, username: server.sshUser, privateKey: server.privateKey, timeoutMs: server.sshTimeoutSeconds * 1000 });
      let output = "";
      const result = await execStream(conn, composeLogsCommand(`yeah-svc-${row.service.id}`, tail), (chunk) => {
        output += chunk;
      });
      if (result.exitCode !== 0) return { logs: "", running: false, message: output.trim() || "nenhum container — faça o deploy primeiro" };
      return { logs: output, running: true };
    } catch (err) {
      set.status = 502;
      return { error: err instanceof Error ? err.message : "falha ao ler os logs" };
    } finally {
      conn?.end();
    }
  })
  .post(
    "/:serviceId/lifecycle",
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
      if (!row.service.composeContent) {
        set.status = 400;
        return { error: "iniciar/parar só vale pra stacks" };
      }
      if (row.service.status === "provisioning") {
        set.status = 409;
        return { error: "há um deploy em andamento — espere terminar" };
      }
      await db.update(services).set({ status: "provisioning" }).where(eq(services.id, row.service.id));
      await serviceProvisionQueue.add("lifecycle", { serviceId: row.service.id, action: body.action });
      return { queued: true };
    },
    { body: t.Object({ action: t.Union([t.Literal("start"), t.Literal("stop"), t.Literal("restart")]) }) },
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

    await db.update(services).set({ status: "provisioning" }).where(eq(services.id, params.serviceId));
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
      const isStack = Boolean(row.service.composeContent);
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
            isStack
              ? `${composeTeardownCommand(containerName)}; rm -rf ${shellQuote(`/opt/yeah-services/${row.service.id}`)} ${shellQuote(`/opt/yeah-backups/volumes/${row.service.id}`)} >/dev/null 2>&1 || true`
              : `docker rm -f ${shellQuote(containerName)} >/dev/null 2>&1 || true && ` + `docker volume rm ${shellQuote(volumeName)} >/dev/null 2>&1 || true`,
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
    await db.delete(volumeBackups).where(and(eq(volumeBackups.ownerType, "service"), eq(volumeBackups.ownerId, params.serviceId)));
    await db.delete(services).where(eq(services.id, params.serviceId));
    return { ok: true };
  });
