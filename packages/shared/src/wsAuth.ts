import type { WsServerEvent } from "./types";

/** Name of the session cookie, shared by the API (which sets it) and the ws service (which reads it). */
export const SESSION_COOKIE = "yeah_session";

/** Parses a `Cookie` request header into a name/value map. Malformed pairs are skipped. */
export function parseCookieHeader(header: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    let value = part.slice(eq + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (!name || name in out) continue; // first occurrence wins, like most servers
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

/** The session id carried by a `Cookie` header, or null. */
export function sessionIdFromCookieHeader(header: string | null | undefined): string | null {
  const id = parseCookieHeader(header)[SESSION_COOKIE];
  return id ? id : null;
}

/**
 * Whether a WebSocket upgrade's `Origin` is acceptable. No configured origins (or no Origin header, as
 * sent by non-browser clients, which cannot ride on a victim's cookies) means "allow"; the cookie is
 * still required either way.
 */
export function isOriginAllowed(origin: string | null | undefined, allowed: string | undefined): boolean {
  const list = (allowed ?? "")
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  if (list.length === 0 || !origin) return true;
  return list.includes(origin.replace(/\/+$/, ""));
}

export type WsResourceKind = "server" | "service" | "application" | "database" | "deployment" | "backup-schedule";

/** Where an event is delivered: to every signed-in user, to one team, or to whichever team owns a resource. */
export type WsEventRoute =
  | { scope: "all" }
  | { scope: "team"; teamId: string }
  | { scope: "resource"; kind: WsResourceKind; id: string };

/**
 * Pure routing decision for an event. An explicit `teamId` on the event (optional, for publishers that
 * know it) wins; otherwise the owning resource is looked up by the ws service. Returns null for events
 * that cannot be attributed to anything, which are dropped rather than broadcast.
 */
export function routeEvent(event: WsServerEvent): WsEventRoute | null {
  const explicit = (event as { teamId?: unknown }).teamId;
  if (typeof explicit === "string" && explicit) return { scope: "team", teamId: explicit };
  switch (event.type) {
    case "server.status":
    case "server.proxy":
    case "server.metrics":
      return resource("server", event.serverId);
    case "service.status":
      return resource("service", event.serviceId);
    case "application.status":
      return resource("application", event.applicationId);
    case "database.status":
      return resource("database", event.databaseId);
    case "deployment.log":
    case "deployment.status":
      return resource("deployment", event.deploymentId);
    case "backup.status":
      return resource("backup-schedule", event.scheduleId);
    case "platform-operation.log":
    case "platform-operation.status":
      // Instance-wide (there is one platform), not owned by any team.
      return { scope: "all" };
    default:
      return null;
  }
}

function resource(kind: WsResourceKind, id: unknown): WsEventRoute | null {
  return typeof id === "string" && id ? { scope: "resource", kind, id } : null;
}

/** Whether a connection whose user belongs to `memberTeams` may receive an event owned by `ownerTeamId`. */
export function canReceive(route: WsEventRoute, ownerTeamId: string | null, memberTeams: ReadonlySet<string>): boolean {
  if (route.scope === "all") return true;
  if (route.scope === "team") return memberTeams.has(route.teamId);
  return ownerTeamId !== null && memberTeams.has(ownerTeamId);
}
