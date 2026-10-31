import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { applications, auditEvents, databases, projects, servers, services, type AuditEvent } from "@yeah/db";
import { describeAuditRequest, type AuditEventDto, type AuditResourceType } from "@yeah/shared";
import { db } from "./db";
import { getUserFromSessionId, SESSION_COOKIE } from "./session";
import { createLogger, parseLogLevel } from "@yeah/shared";

const log = createLogger("api", { format: process.env.LOG_FORMAT === "text" ? "text" : "json", minLevel: parseLogLevel(process.env.LOG_LEVEL) });

/** Records a successful mutating request. Never throws — auditing must not break the request it describes. */
export async function recordAuditFromRequest(request: Request, status: number, cookie: Record<string, { value?: unknown } | undefined>): Promise<void> {
  try {
    const url = new URL(request.url);
    const info = describeAuditRequest(request.method, url.pathname, status);
    if (!info) return;
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    const viaToken = !user && (request.headers.get("authorization") ?? "").toLowerCase().startsWith("bearer ");
    await db.insert(auditEvents).values({
      teamId: info.teamId,
      userId: user?.id ?? null,
      actor: user ? user.email : viaToken ? "token de API" : null,
      action: info.action,
      level: info.level,
      resourceType: info.resourceType,
      resourceId: info.resourceId,
      refs: JSON.stringify(info.ids),
      method: request.method.toUpperCase(),
      path: url.pathname.slice(0, 512),
    });
  } catch (err) {
    log.warn("audit write failed", { err });
  }
}

type Names = Map<string, string>;

/** Current names for the resources the page shows; deleted ones simply have no name any more. */
async function resolveNames(events: AuditEvent[]): Promise<Names> {
  const ids: Record<"application" | "service" | "database" | "server" | "project", Set<string>> = { application: new Set(), service: new Set(), database: new Set(), server: new Set(), project: new Set() };
  for (const e of events) {
    if (e.resourceId && e.resourceType in ids) ids[e.resourceType as keyof typeof ids].add(e.resourceId);
  }
  const names: Names = new Map();
  const load = async (set: Set<string>, run: (list: string[]) => Promise<Array<{ id: string; name: string }>>) => {
    if (!set.size) return;
    for (const row of await run([...set])) names.set(row.id, row.name);
  };
  await Promise.all([
    load(ids.application, (l) => db.select({ id: applications.id, name: applications.name }).from(applications).where(inArray(applications.id, l))),
    load(ids.service, (l) => db.select({ id: services.id, name: services.name }).from(services).where(inArray(services.id, l))),
    load(ids.database, (l) => db.select({ id: databases.id, name: databases.name }).from(databases).where(inArray(databases.id, l))),
    load(ids.server, (l) => db.select({ id: servers.id, name: servers.name }).from(servers).where(inArray(servers.id, l))),
    load(ids.project, (l) => db.select({ id: projects.id, name: projects.name }).from(projects).where(inArray(projects.id, l))),
  ]);
  return names;
}

export interface AuditQuery {
  teamId: string;
  limit: number;
  before?: Date;
  level?: "info" | "warning";
  resourceType?: AuditResourceType;
}

export async function listAuditEvents(query: AuditQuery): Promise<AuditEventDto[]> {
  const conditions = [eq(auditEvents.teamId, query.teamId)];
  if (query.before) conditions.push(lt(auditEvents.createdAt, query.before));
  if (query.level) conditions.push(eq(auditEvents.level, query.level));
  if (query.resourceType) conditions.push(eq(auditEvents.resourceType, query.resourceType));
  const rows = await db.select().from(auditEvents).where(and(...conditions)).orderBy(desc(auditEvents.createdAt)).limit(query.limit);
  const names = await resolveNames(rows);
  return rows.map((e) => ({
    id: e.id,
    teamId: e.teamId,
    actor: e.actor,
    action: e.action,
    level: e.level === "warning" ? "warning" : "info",
    resourceType: e.resourceType as AuditResourceType,
    resourceId: e.resourceId,
    resourceName: e.resourceId ? (names.get(e.resourceId) ?? null) : null,
    method: e.method,
    path: e.path,
    createdAt: e.createdAt.toISOString(),
  }));
}
