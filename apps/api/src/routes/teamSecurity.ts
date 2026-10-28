import { Elysia, t } from "elysia";
import { and, eq } from "drizzle-orm";
import { teamMembers, teams, users } from "@yeah/db";
import { db } from "../lib/db";
import { getUserFromSessionId, SESSION_COOKIE } from "../lib/session";
import { assertMember, assertTeamAdmin } from "../lib/access";

// Team-wide security policy. For now one switch: require two-factor authentication from every member.

export const teamSecurityRoutes = new Elysia({ prefix: "/teams/:teamId" })
  .get("/security", async ({ cookie, params, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    if (!(await assertMember(params.teamId, user.id))) {
      set.status = 403;
      return { error: "forbidden" };
    }
    const [team] = await db.select({ requireTwoFactor: teams.requireTwoFactor }).from(teams).where(eq(teams.id, params.teamId)).limit(1);
    // Who would be locked out: members that have no 2FA yet.
    const without = await db
      .select({ email: users.email })
      .from(teamMembers)
      .innerJoin(users, eq(users.id, teamMembers.userId))
      .where(and(eq(teamMembers.teamId, params.teamId), eq(users.totpEnabled, false)));
    return { requireTwoFactor: team?.requireTwoFactor ?? false, membersWithoutTwoFactor: without.map((m) => m.email), youHaveTwoFactor: user.totpEnabled };
  })
  .put(
    "/security",
    async ({ cookie, params, body, set }) => {
      const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
      if (!user) {
        set.status = 401;
        return { error: "unauthorized" };
      }
      if (!(await assertTeamAdmin(params.teamId, user.id))) {
        set.status = 403;
        return { error: "só o dono ou um administrador do time pode mudar isto" };
      }
      // Whoever turns it on must already have 2FA, otherwise they would lock themselves out.
      if (body.requireTwoFactor && !user.totpEnabled) {
        set.status = 400;
        return { error: "ative o 2FA na sua própria conta antes de exigir 2FA do time" };
      }
      await db.update(teams).set({ requireTwoFactor: body.requireTwoFactor }).where(eq(teams.id, params.teamId));
      return { requireTwoFactor: body.requireTwoFactor };
    },
    { body: t.Object({ requireTwoFactor: t.Boolean() }) },
  );
