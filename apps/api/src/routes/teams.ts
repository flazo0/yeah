import { Elysia, t } from "elysia";
import { and, count, desc, eq } from "drizzle-orm";
import { applications, databases, deployments, servers, services, teams, teamMembers } from "@yeah/db";
import type { TeamDto, TeamOverviewDto, TeamRole } from "@yeah/shared";
import { db } from "../lib/db";
import { getUserFromSessionId, SESSION_COOKIE } from "../lib/session";
import { assertMember } from "../lib/access";
import { createDefaultProject } from "../lib/projects";

export const teamRoutes = new Elysia({ prefix: "/teams" })
  .get("/", async ({ cookie, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }

    const rows = await db
      .select({ team: teams, role: teamMembers.role })
      .from(teamMembers)
      .innerJoin(teams, eq(teamMembers.teamId, teams.id))
      .where(eq(teamMembers.userId, user.id));

    const result: TeamDto[] = rows.map((row) => ({
      id: row.team.id,
      name: row.team.name,
      description: row.team.description,
      personal: row.team.personal,
      role: row.role as TeamRole,
      createdAt: row.team.createdAt.toISOString(),
    }));

    return { teams: result };
  })
  .post(
    "/",
    async ({ cookie, body, set }) => {
      const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
      if (!user) {
        set.status = 401;
        return { error: "unauthorized" };
      }

      const [team] = await db.insert(teams).values({ name: body.name, personal: false }).returning();
      if (!team) {
        set.status = 500;
        return { error: "failed to create team" };
      }
      await db.insert(teamMembers).values({ teamId: team.id, userId: user.id, role: "owner" });
      await createDefaultProject(team.id);

      const dto: TeamDto = {
        id: team.id,
        name: team.name,
        description: team.description,
        personal: team.personal,
        role: "owner",
        createdAt: team.createdAt.toISOString(),
      };
      return { team: dto };
    },
    { body: t.Object({ name: t.String({ minLength: 1 }) }) },
  )
  .put(
    "/:teamId",
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

      const name = body.name.trim();
      if (!name) {
        set.status = 400;
        return { error: "o nome não pode ficar vazio" };
      }
      const description = body.description === undefined ? undefined : body.description.trim() || null;
      const [team] = await db
        .update(teams)
        .set(description === undefined ? { name } : { name, description })
        .where(eq(teams.id, params.teamId))
        .returning();
      if (!team) {
        set.status = 404;
        return { error: "team not found" };
      }
      const [member] = await db
        .select({ role: teamMembers.role })
        .from(teamMembers)
        .where(and(eq(teamMembers.teamId, team.id), eq(teamMembers.userId, user.id)))
        .limit(1);
      const dto: TeamDto = {
        id: team.id,
        name: team.name,
        description: team.description,
        personal: team.personal,
        role: (member?.role ?? "owner") as TeamRole,
        createdAt: team.createdAt.toISOString(),
      };
      return { team: dto };
    },
    { body: t.Object({ name: t.String({ minLength: 1, maxLength: 255 }), description: t.Optional(t.String({ maxLength: 1000 })) }) },
  )
  .get("/:teamId/overview", async ({ cookie, params, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    if (!(await assertMember(params.teamId, user.id))) {
      set.status = 403;
      return { error: "forbidden" };
    }

    const [[appCount], [dbCount], [svcCount], [srvCount], recentRows] = await Promise.all([
      db.select({ value: count() }).from(applications).where(eq(applications.teamId, params.teamId)),
      db.select({ value: count() }).from(databases).where(eq(databases.teamId, params.teamId)),
      db.select({ value: count() }).from(services).where(eq(services.teamId, params.teamId)),
      db.select({ value: count() }).from(servers).where(eq(servers.teamId, params.teamId)),
      db
        .select({ deployment: deployments, applicationName: applications.name, applicationId: applications.id })
        .from(deployments)
        .innerJoin(applications, eq(deployments.applicationId, applications.id))
        .where(eq(applications.teamId, params.teamId))
        .orderBy(desc(deployments.createdAt))
        .limit(8),
    ]);

    const overview: TeamOverviewDto = {
      counts: {
        applications: appCount?.value ?? 0,
        databases: dbCount?.value ?? 0,
        services: svcCount?.value ?? 0,
        servers: srvCount?.value ?? 0,
      },
      recentDeployments: recentRows.map((row) => ({
        id: row.deployment.id,
        applicationId: row.applicationId,
        applicationName: row.applicationName,
        status: row.deployment.status,
        createdAt: row.deployment.createdAt.toISOString(),
      })),
    };

    return { overview };
  });

// No team-invitation routes here on purpose: yeah is single-admin (see auth.ts's
// hasAnyUser()/setup-status lock on /auth/register) — there's deliberately no path for a second
// person to ever get a login on the same instance. teamInvitations/teamMembers.role stay in the
// schema because every resource is scoped by teamId either way, not because more than one person
// is ever meant to hold one.
