import type { ServerWebSocket } from "bun";
import { eq } from "drizzle-orm";
import {
  applications,
  backupSchedules,
  createDb,
  databases,
  deployments,
  findSessionUserId,
  servers,
  services,
  teamMembers,
} from "@yeah/db";
import { createRedisConnection, subscribeServerEvents } from "@yeah/queue";
import {
  canReceive,
  createLogger,
  isOriginAllowed,
  parseLogLevel,
  routeEvent,
  sessionIdFromCookieHeader,
  type WsEventRoute,
  type WsResourceKind,
  type WsServerEvent,
} from "@yeah/shared";

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) throw new Error("REDIS_URL is not set");
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not set");
const port = process.env.WS_PORT ? Number(process.env.WS_PORT) : 3001;

const log = createLogger("ws", {
  format: process.env.LOG_FORMAT === "text" ? "text" : "json",
  minLevel: parseLogLevel(process.env.LOG_LEVEL),
});
const db = createDb(databaseUrl);

/** How often every open socket re-checks its session and team memberships (revocation latency). */
const REFRESH_MS = 60_000;
/** Resource -> owning team never changes in practice, so lookups are cached for a while. */
const OWNER_TTL_MS = 5 * 60_000;
const OWNER_CACHE_MAX = 5000;

interface ConnData {
  sessionId: string;
  userId: string;
  teams: Set<string>;
}

const clients = new Set<ServerWebSocket<ConnData>>();

async function loadTeams(userId: string): Promise<Set<string>> {
  const rows = await db.select({ teamId: teamMembers.teamId }).from(teamMembers).where(eq(teamMembers.userId, userId));
  return new Set(rows.map((r) => r.teamId));
}

async function lookupOwner(kind: WsResourceKind, id: string): Promise<string | null> {
  switch (kind) {
    case "server":
      return (await db.select({ t: servers.teamId }).from(servers).where(eq(servers.id, id)).limit(1))[0]?.t ?? null;
    case "service":
      return (await db.select({ t: services.teamId }).from(services).where(eq(services.id, id)).limit(1))[0]?.t ?? null;
    case "application":
      return (await db.select({ t: applications.teamId }).from(applications).where(eq(applications.id, id)).limit(1))[0]?.t ?? null;
    case "database":
      return (await db.select({ t: databases.teamId }).from(databases).where(eq(databases.id, id)).limit(1))[0]?.t ?? null;
    case "deployment":
      return (
        (
          await db
            .select({ t: applications.teamId })
            .from(deployments)
            .innerJoin(applications, eq(deployments.applicationId, applications.id))
            .where(eq(deployments.id, id))
            .limit(1)
        )[0]?.t ?? null
      );
    case "backup-schedule":
      return (
        (
          await db
            .select({ t: databases.teamId })
            .from(backupSchedules)
            .innerJoin(databases, eq(backupSchedules.databaseId, databases.id))
            .where(eq(backupSchedules.id, id))
            .limit(1)
        )[0]?.t ?? null
      );
  }
}

const ownerCache = new Map<string, { teamId: string; expires: number }>();

async function ownerOf(route: WsEventRoute & { scope: "resource" }): Promise<string | null> {
  const key = `${route.kind}:${route.id}`;
  const hit = ownerCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.teamId;
  const teamId = await lookupOwner(route.kind, route.id);
  if (teamId) {
    if (ownerCache.size >= OWNER_CACHE_MAX) ownerCache.clear();
    ownerCache.set(key, { teamId, expires: Date.now() + OWNER_TTL_MS });
  }
  return teamId; // misses (e.g. a just-deleted resource) are not cached
}

const allowedOrigins = process.env.WEB_ORIGIN;

const server = Bun.serve<ConnData>({
  port,
  async fetch(req, srv) {
    if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("yeah ws service", { status: 200 });
    }
    if (!isOriginAllowed(req.headers.get("origin"), allowedOrigins)) {
      return new Response("forbidden", { status: 403 });
    }
    const sessionId = sessionIdFromCookieHeader(req.headers.get("cookie"));
    const userId = sessionId ? await findSessionUserId(db, sessionId).catch(() => null) : null;
    if (!sessionId || !userId) return new Response("unauthorized", { status: 401 });
    const teams = await loadTeams(userId).catch(() => null);
    if (!teams) return new Response("unavailable", { status: 503 });
    if (srv.upgrade(req, { data: { sessionId, userId, teams } })) return;
    return new Response("upgrade failed", { status: 400 });
  },
  websocket: {
    open(ws) {
      clients.add(ws);
    },
    close(ws) {
      clients.delete(ws);
    },
    message() {
      // The channel is server -> client only.
    },
  },
});

async function dispatch(event: WsServerEvent) {
  const route = routeEvent(event);
  if (!route || clients.size === 0) return;
  const owner = route.scope === "resource" ? await ownerOf(route) : null;
  const payload = JSON.stringify(event);
  for (const client of clients) {
    if (canReceive(route, owner, client.data.teams)) client.send(payload);
  }
}

/** Drops sockets whose session expired or was revoked, and refreshes everyone's team list. */
let refreshing = false;
async function refreshClients() {
  if (refreshing) return; // a slow database must not stack up overlapping sweeps
  refreshing = true;
  try {
    await refreshAll();
  } finally {
    refreshing = false;
  }
}

async function refreshAll() {
  for (const client of [...clients]) {
    try {
      const userId = await findSessionUserId(db, client.data.sessionId);
      if (!userId) {
        client.close(4401, "session ended");
        continue;
      }
      client.data.teams = await loadTeams(client.data.userId);
    } catch (err) {
      log.warn("refresh failed", { error: err instanceof Error ? err.message : String(err) });
    }
  }
}
setInterval(() => void refreshClients(), REFRESH_MS);

const subscriber = createRedisConnection(redisUrl);
subscribeServerEvents(subscriber, (event) => {
  dispatch(event).catch((err) => log.warn("dispatch failed", { error: err instanceof Error ? err.message : String(err) }));
});

log.info("listening", { port: server.port });
