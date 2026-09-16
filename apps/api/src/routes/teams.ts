import { Elysia, t } from "elysia";
import { and, eq } from "drizzle-orm";
import { teams, teamMembers, teamInvitations } from "@yeah/db";
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
  )
  .post(
    "/:teamId/invitations",
    async ({ cookie, params, body, set }) => {
      const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
      if (!user) {
        set.status = 401;
        return { error: "unauthorized" };
      }

      const membership = await db
        .select()
        .from(teamMembers)
        .where(and(eq(teamMembers.teamId, params.teamId), eq(teamMembers.userId, user.id)))
        .limit(1);
      const role = membership[0]?.role;
      if (role !== "owner" && role !== "admin") {
        set.status = 403;
        return { error: "forbidden" };
      }

      const token = crypto.randomUUID().replace(/-/g, "");
      const [invitation] = await db
        .insert(teamInvitations)
        .values({ teamId: params.teamId, email: body.email, role: body.role ?? "member", token })
        .returning();

      return { invitation };
    },
    {
      body: t.Object({
        email: t.String({ format: "email" }),
        role: t.Optional(t.Union([t.Literal("admin"), t.Literal("member")])),
      }),
    },
  )
  .post("/invitations/:token/accept", async ({ cookie, params, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }

    const rows = await db.select().from(teamInvitations).where(eq(teamInvitations.token, params.token)).limit(1);
    const invitation = rows[0];
    if (!invitation || invitation.acceptedAt) {
      set.status = 404;
      return { error: "invitation not found" };
    }

    await db.insert(teamMembers).values({ teamId: invitation.teamId, userId: user.id, role: invitation.role });
    await db.update(teamInvitations).set({ acceptedAt: new Date() }).where(eq(teamInvitations.id, invitation.id));

    return { ok: true };
  });
