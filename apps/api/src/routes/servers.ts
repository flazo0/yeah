import { Elysia, t } from "elysia";
import { and, count, eq, gte } from "drizzle-orm";
import { applications, databases, serverMetricSamples, servers, services, sshKeys, type Server } from "@yeah/db";
import { connectSsh, execStream, generateSshKeyPair } from "@yeah/ssh";
import { buildProxyIsRunningCommand, buildProxyLogsCommand, type ServerDto } from "@yeah/shared";
import { db } from "../lib/db";
import { getUserFromSessionId, SESSION_COOKIE } from "../lib/session";
import { serverCheckQueue, proxyProvisionQueue, cloudflareTunnelQueue } from "../lib/queue";
import { assertMember } from "../lib/access";

function toServerDto(server: Server): ServerDto {
  return {
    id: server.id,
    teamId: server.teamId,
    name: server.name,
    host: server.host,
    port: server.port,
    sshUser: server.sshUser,
    sshTimeoutSeconds: server.sshTimeoutSeconds,
    status: server.status,
    dockerVersion: server.dockerVersion,
    lastCheckedAt: server.lastCheckedAt ? server.lastCheckedAt.toISOString() : null,
    wildcardDomain: server.wildcardDomain,
    acmeEmail: server.acmeEmail,
    proxyStatus: server.proxyStatus,
    cpuPercent: server.cpuPercent,
    memPercent: server.memPercent,
    diskPercent: server.diskPercent,
    metricsCheckedAt: server.metricsCheckedAt ? server.metricsCheckedAt.toISOString() : null,
    metricsEnabled: server.metricsEnabled,
    sshKeyId: server.sshKeyId,
    cloudflareTunnelConfigured: server.cloudflareTunnelToken !== null,
    cloudflareTunnelStatus: server.cloudflareTunnelStatus,
    cloudflareTunnelError: server.cloudflareTunnelError,
    trafficAnalyticsEnabled: server.trafficAnalyticsEnabled,
    createdAt: server.createdAt.toISOString(),
  };
}

export const serverRoutes = new Elysia({ prefix: "/teams/:teamId/servers" })
  // A fresh ed25519 keypair for the "add server" form: the private half goes into that form, the public
  // half is what the user authorizes on the machine. Nothing is stored here.
  .post("/generate-key", async ({ cookie, params, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    if (!(await assertMember(params.teamId, user.id))) {
      set.status = 403;
      return { error: "forbidden" };
    }
    return generateSshKeyPair("yeah");
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

    const rows = await db.select().from(servers).where(eq(servers.teamId, params.teamId));
    return { servers: rows.map(toServerDto) };
  })
  // One round trip for every server's CPU/mem/disk history — the Dashboard's sparklines and each
  // server's own "Recursos" chart both read this (the latter passing a single serverId is still just
  // this same shape, filtered client-side, so there's one code path instead of two).
  .get("/metrics-history", async ({ cookie, params, query, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    if (!(await assertMember(params.teamId, user.id))) {
      set.status = 403;
      return { error: "forbidden" };
    }
    const hours = Math.min(168, Math.max(1, Number(query.hours) || 24));
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    const rows = await db
      .select({ serverId: serverMetricSamples.serverId, cpuPercent: serverMetricSamples.cpuPercent, memPercent: serverMetricSamples.memPercent, diskPercent: serverMetricSamples.diskPercent, capturedAt: serverMetricSamples.capturedAt })
      .from(serverMetricSamples)
      .innerJoin(servers, eq(servers.id, serverMetricSamples.serverId))
      .where(and(eq(servers.teamId, params.teamId), gte(serverMetricSamples.capturedAt, since)))
      .orderBy(serverMetricSamples.capturedAt);
    const history: Record<string, Array<{ at: string; cpu: number; mem: number; disk: number }>> = {};
    for (const row of rows) {
      (history[row.serverId] ??= []).push({ at: row.capturedAt.toISOString(), cpu: row.cpuPercent, mem: row.memPercent, disk: row.diskPercent });
    }
    return { history };
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

      // Either paste/generate a key inline (privateKey), or reuse one already in Keys & Tokens
      // (sshKeyId) — the row keeps its own copy either way, so rotating/deleting the reusable key
      // later never breaks a connection that's already working.
      let privateKey = body.privateKey ?? null;
      let sshKeyId: string | null = null;
      if (body.sshKeyId) {
        const [key] = await db.select().from(sshKeys).where(and(eq(sshKeys.id, body.sshKeyId), eq(sshKeys.teamId, params.teamId))).limit(1);
        if (!key) {
          set.status = 404;
          return { error: "ssh key not found" };
        }
        privateKey = key.privateKey;
        sshKeyId = key.id;
      }
      if (!privateKey) {
        set.status = 400;
        return { error: "informe privateKey ou sshKeyId" };
      }

      const [server] = await db
        .insert(servers)
        .values({
          teamId: params.teamId,
          name: body.name,
          host: body.host,
          port: body.port ?? 22,
          sshUser: body.sshUser ?? "root",
          privateKey,
          sshKeyId,
        })
        .returning();
      if (!server) {
        set.status = 500;
        return { error: "failed to create server" };
      }

      return { server: toServerDto(server) };
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        host: t.String({ minLength: 1 }),
        port: t.Optional(t.Number()),
        sshUser: t.Optional(t.String()),
        privateKey: t.Optional(t.String({ minLength: 1 })),
        sshKeyId: t.Optional(t.String()),
      }),
    },
  )
  .post("/:serverId/test-connection", async ({ cookie, params, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    if (!(await assertMember(params.teamId, user.id))) {
      set.status = 403;
      return { error: "forbidden" };
    }

    const rows = await db
      .select()
      .from(servers)
      .where(and(eq(servers.id, params.serverId), eq(servers.teamId, params.teamId)))
      .limit(1);
    const server = rows[0];
    if (!server) {
      set.status = 404;
      return { error: "server not found" };
    }

    // The API never talks SSH to a customer's server directly — it hands the
    // slow network call to the worker and returns immediately. The browser
    // gets the result over the `ws` service once the job finishes.
    const job = await serverCheckQueue.add("check", { serverId: server.id });
    return { queued: true, jobId: job.id };
  })
  .put(
    "/:serverId/domain",
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

      const [server] = await db
        .update(servers)
        .set({ wildcardDomain: body.wildcardDomain || null, acmeEmail: body.acmeEmail || null })
        .where(and(eq(servers.id, params.serverId), eq(servers.teamId, params.teamId)))
        .returning();
      if (!server) {
        set.status = 404;
        return { error: "server not found" };
      }

      return { server: toServerDto(server) };
    },
    {
      body: t.Object({
        wildcardDomain: t.Optional(t.String()),
        acmeEmail: t.Optional(t.String()),
      }),
    },
  )
  .put(
    "/:serverId/ssh",
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
      if (!Number.isInteger(body.sshTimeoutSeconds) || body.sshTimeoutSeconds < 5 || body.sshTimeoutSeconds > 120) {
        set.status = 400;
        return { error: "o timeout SSH precisa ser de 5 a 120 segundos" };
      }
      const [server] = await db
        .update(servers)
        .set({ sshTimeoutSeconds: body.sshTimeoutSeconds })
        .where(and(eq(servers.id, params.serverId), eq(servers.teamId, params.teamId)))
        .returning();
      if (!server) {
        set.status = 404;
        return { error: "server not found" };
      }
      return { server: toServerDto(server) };
    },
    { body: t.Object({ sshTimeoutSeconds: t.Number() }) },
  )
  .put(
    "/:serverId/metrics-enabled",
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
      const [server] = await db
        .update(servers)
        .set({ metricsEnabled: body.metricsEnabled })
        .where(and(eq(servers.id, params.serverId), eq(servers.teamId, params.teamId)))
        .returning();
      if (!server) {
        set.status = 404;
        return { error: "server not found" };
      }
      return { server: toServerDto(server) };
    },
    { body: t.Object({ metricsEnabled: t.Boolean() }) },
  )
  .put(
    "/:serverId/cloudflare-tunnel",
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
      if (!body.token.trim()) {
        set.status = 400;
        return { error: "token vazio" };
      }
      const [server] = await db
        .update(servers)
        .set({ cloudflareTunnelToken: body.token.trim(), cloudflareTunnelStatus: "provisioning", cloudflareTunnelError: null })
        .where(and(eq(servers.id, params.serverId), eq(servers.teamId, params.teamId)))
        .returning();
      if (!server) {
        set.status = 404;
        return { error: "server not found" };
      }
      await cloudflareTunnelQueue.add("install", { serverId: server.id, action: "install", token: body.token.trim() });
      return { server: toServerDto(server) };
    },
    { body: t.Object({ token: t.String({ minLength: 1, maxLength: 2000 }) }) },
  )
  .delete("/:serverId/cloudflare-tunnel", async ({ cookie, params, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    if (!(await assertMember(params.teamId, user.id))) {
      set.status = 403;
      return { error: "forbidden" };
    }
    const [server] = await db
      .update(servers)
      .set({ cloudflareTunnelStatus: "provisioning", cloudflareTunnelError: null })
      .where(and(eq(servers.id, params.serverId), eq(servers.teamId, params.teamId)))
      .returning();
    if (!server) {
      set.status = 404;
      return { error: "server not found" };
    }
    await cloudflareTunnelQueue.add("remove", { serverId: server.id, action: "remove" });
    return { server: toServerDto(server) };
  })
  .put(
    "/:serverId/traffic-analytics",
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
      const [server] = await db
        .update(servers)
        .set({ trafficAnalyticsEnabled: body.enabled })
        .where(and(eq(servers.id, params.serverId), eq(servers.teamId, params.teamId)))
        .returning();
      if (!server) {
        set.status = 404;
        return { error: "server not found" };
      }
      // The metrics entrypoint's port mapping only takes effect on a fresh container — re-provision
      // now if the proxy is already up, otherwise the next activation already reads the new flag.
      if (server.proxyStatus === "active") {
        await proxyProvisionQueue.add("provision", { serverId: server.id, action: "provision" });
      }
      return { server: toServerDto(server) };
    },
    { body: t.Object({ enabled: t.Boolean() }) },
  )
  .post("/:serverId/proxy", async ({ cookie, params, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    if (!(await assertMember(params.teamId, user.id))) {
      set.status = 403;
      return { error: "forbidden" };
    }

    const rows = await db
      .select()
      .from(servers)
      .where(and(eq(servers.id, params.serverId), eq(servers.teamId, params.teamId)))
      .limit(1);
    const server = rows[0];
    if (!server) {
      set.status = 404;
      return { error: "server not found" };
    }
    if (!server.acmeEmail) {
      set.status = 400;
      return { error: "configure o e-mail do Let's Encrypt antes de ativar o proxy" };
    }

    await db.update(servers).set({ proxyStatus: "provisioning" }).where(eq(servers.id, server.id));
    await proxyProvisionQueue.add("provision", { serverId: server.id });
    return { queued: true };
  })
  .post("/:serverId/proxy/restart", async ({ cookie, params, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    if (!(await assertMember(params.teamId, user.id))) {
      set.status = 403;
      return { error: "forbidden" };
    }
    const rows = await db.select().from(servers).where(and(eq(servers.id, params.serverId), eq(servers.teamId, params.teamId))).limit(1);
    const server = rows[0];
    if (!server) {
      set.status = 404;
      return { error: "server not found" };
    }
    if (server.proxyStatus !== "active" && server.proxyStatus !== "error") {
      set.status = 400;
      return { error: "o proxy não está ativo neste servidor" };
    }
    await db.update(servers).set({ proxyStatus: "provisioning" }).where(eq(servers.id, server.id));
    await proxyProvisionQueue.add("restart", { serverId: server.id, action: "restart" });
    return { queued: true };
  })
  // Bounded read for a browser waiting on it — same documented exception as container/service logs.
  .get("/:serverId/proxy/logs", async ({ cookie, params, query, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    if (!(await assertMember(params.teamId, user.id))) {
      set.status = 403;
      return { error: "forbidden" };
    }
    const rows = await db.select().from(servers).where(and(eq(servers.id, params.serverId), eq(servers.teamId, params.teamId))).limit(1);
    const server = rows[0];
    if (!server) {
      set.status = 404;
      return { error: "server not found" };
    }
    const tail = Math.min(2000, Math.max(1, Number(query.tail) || 300));
    let conn: Awaited<ReturnType<typeof connectSsh>> | null = null;
    try {
      conn = await connectSsh({ host: server.host, port: server.port, username: server.sshUser, privateKey: server.privateKey, timeoutMs: server.sshTimeoutSeconds * 1000 });
      let running = "";
      await execStream(conn, buildProxyIsRunningCommand(), (c) => (running += c));
      let output = "";
      const result = await execStream(conn, buildProxyLogsCommand(tail), (chunk) => {
        output += chunk;
      });
      if (result.exitCode !== 0) return { logs: "", running: false, message: output.trim() || "o proxy não está ativo neste servidor" };
      return { logs: output, running: running.trim() === "true" };
    } catch (err) {
      set.status = 502;
      return { error: err instanceof Error ? err.message : "falha ao ler os logs" };
    } finally {
      conn?.end();
    }
  })
  // Removes the server from the panel only: nothing on the machine itself is touched (containers,
  // Traefik and files stay). Refused while anything is still deployed on it, since the rows of those
  // resources would cascade away while their containers kept running.
  .delete("/:serverId", async ({ cookie, params, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    if (!(await assertMember(params.teamId, user.id))) {
      set.status = 403;
      return { error: "forbidden" };
    }

    const rows = await db
      .select()
      .from(servers)
      .where(and(eq(servers.id, params.serverId), eq(servers.teamId, params.teamId)))
      .limit(1);
    const server = rows[0];
    if (!server) {
      set.status = 404;
      return { error: "server not found" };
    }

    const [apps, dbs, svcs] = await Promise.all(
      [applications, databases, services].map(async (table) => {
        const [row] = await db.select({ n: count() }).from(table).where(eq(table.serverId, server.id));
        return row?.n ?? 0;
      }),
    );
    if ((apps ?? 0) + (dbs ?? 0) + (svcs ?? 0) > 0) {
      set.status = 409;
      return {
        error: `Ainda há recursos neste servidor (${apps} aplicação(ões), ${dbs} banco(s), ${svcs} serviço(s)). Exclua ou mova esses recursos antes de remover o servidor.`,
      };
    }

    await db.delete(servers).where(eq(servers.id, server.id));
    return { ok: true };
  });
