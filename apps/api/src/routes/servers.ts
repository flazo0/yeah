import { Elysia, t } from "elysia";
import { and, eq } from "drizzle-orm";
import { servers, type Server } from "@yeah/db";
import type { ServerDto } from "@yeah/shared";
import { db } from "../lib/db";
import { getUserFromSessionId, SESSION_COOKIE } from "../lib/session";
import { serverCheckQueue, proxyProvisionQueue } from "../lib/queue";
import { assertMember } from "../lib/access";

function toServerDto(server: Server): ServerDto {
  return {
    id: server.id,
    teamId: server.teamId,
    name: server.name,
    host: server.host,
    port: server.port,
    sshUser: server.sshUser,
    status: server.status,
    dockerVersion: server.dockerVersion,
    lastCheckedAt: server.lastCheckedAt ? server.lastCheckedAt.toISOString() : null,
    wildcardDomain: server.wildcardDomain,
    acmeEmail: server.acmeEmail,
    proxyStatus: server.proxyStatus,
    createdAt: server.createdAt.toISOString(),
  };
}

export const serverRoutes = new Elysia({ prefix: "/teams/:teamId/servers" })
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

      const [server] = await db
        .insert(servers)
        .values({
          teamId: params.teamId,
          name: body.name,
          host: body.host,
          port: body.port ?? 22,
          sshUser: body.sshUser ?? "root",
          privateKey: body.privateKey,
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
        privateKey: t.String({ minLength: 1 }),
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
  });
