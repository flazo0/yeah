import { Elysia, t } from "elysia";
import { eq } from "drizzle-orm";
import { teams, teamMembers } from "@yeah/db";
import type { TeamDto, TeamRole } from "@yeah/shared";
import { db } from "../lib/db";
import { getUserFromSessionId, SESSION_COOKIE } from "../lib/session";
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
        personal: team.personal,
        role: "owner",
        createdAt: team.createdAt.toISOString(),
      };
      return { team: dto };
    },
    { body: t.Object({ name: t.String({ minLength: 1 }) }) },
  );

// No team-invitation routes here on purpose: yeah is single-admin (see auth.ts's
// hasAnyUser()/setup-status lock on /auth/register) — there's deliberately no path for a second
// person to ever get a login on the same instance. teamInvitations/teamMembers.role stay in the
// schema because every resource is scoped by teamId either way, not because more than one person
// is ever meant to hold one.
