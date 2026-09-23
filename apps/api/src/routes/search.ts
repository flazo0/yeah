import { Elysia, t } from "elysia";
import { and, eq, ilike } from "drizzle-orm";
import { applications, databases, environments, projects, servers, services } from "@yeah/db";
import type { SearchResultDto } from "@yeah/shared";
import { db } from "../lib/db";
import { getUserFromSessionId, SESSION_COOKIE } from "../lib/session";
import { assertMember } from "../lib/access";

const LIMIT = 6;

/** LIKE wildcards in what the user typed are literals, not patterns. */
function likePattern(q: string): string {
  return `%${q.replace(/[\%_]/g, (c) => `\${c}`)}%`;
}

export const searchRoutes = new Elysia().get(
  "/teams/:teamId/search",
  async ({ cookie, params, query, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    if (!(await assertMember(params.teamId, user.id))) {
      set.status = 403;
      return { error: "forbidden" };
    }

    const q = query.q.trim();
    if (!q) return { results: [] as SearchResultDto[] };
    const pattern = likePattern(q);
    const teamId = params.teamId;
    const envPath = (projectId: string, environmentId: string) => `/teams/${teamId}/projects/${projectId}/environments/${environmentId}`;

    const [projectRows, serverRows, appRows, dbRows, svcRows] = await Promise.all([
      db.select().from(projects).where(and(eq(projects.teamId, teamId), ilike(projects.name, pattern))).limit(LIMIT),
      db.select().from(servers).where(and(eq(servers.teamId, teamId), ilike(servers.name, pattern))).limit(LIMIT),
      db
        .select({ id: applications.id, name: applications.name, projectId: projects.id, projectName: projects.name, environmentId: environments.id })
        .from(applications)
        .innerJoin(environments, eq(environments.id, applications.environmentId))
        .innerJoin(projects, eq(projects.id, environments.projectId))
        .where(and(eq(applications.teamId, teamId), ilike(applications.name, pattern)))
        .limit(LIMIT),
      db
        .select({ id: databases.id, name: databases.name, projectId: projects.id, projectName: projects.name, environmentId: environments.id })
        .from(databases)
        .innerJoin(environments, eq(environments.id, databases.environmentId))
        .innerJoin(projects, eq(projects.id, environments.projectId))
        .where(and(eq(databases.teamId, teamId), ilike(databases.name, pattern)))
        .limit(LIMIT),
      db
        .select({ id: services.id, name: services.name, projectId: projects.id, projectName: projects.name, environmentId: environments.id })
        .from(services)
        .innerJoin(environments, eq(environments.id, services.environmentId))
        .innerJoin(projects, eq(projects.id, environments.projectId))
        .where(and(eq(services.teamId, teamId), ilike(services.name, pattern)))
        .limit(LIMIT),
    ]);

    const results: SearchResultDto[] = [
      ...projectRows.map((p) => ({ kind: "project" as const, id: p.id, name: p.name, subtitle: "Projeto", path: `/teams/${teamId}/projects/${p.id}` })),
      ...serverRows.map((s) => ({ kind: "server" as const, id: s.id, name: s.name, subtitle: `Servidor · ${s.host}`, path: `/teams/${teamId}/servers/${s.id}/general` })),
      ...appRows.map((r) => ({ kind: "application" as const, id: r.id, name: r.name, subtitle: `Aplicação · ${r.projectName}`, path: `${envPath(r.projectId, r.environmentId)}/apps/${r.id}` })),
      ...dbRows.map((r) => ({ kind: "database" as const, id: r.id, name: r.name, subtitle: `Banco de dados · ${r.projectName}`, path: `${envPath(r.projectId, r.environmentId)}/databases/${r.id}` })),
      ...svcRows.map((r) => ({ kind: "service" as const, id: r.id, name: r.name, subtitle: `Serviço · ${r.projectName}`, path: `${envPath(r.projectId, r.environmentId)}/services/${r.id}` })),
    ];
    return { results };
  },
  { query: t.Object({ q: t.String({ maxLength: 100 }) }) },
);
