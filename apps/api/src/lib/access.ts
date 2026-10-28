import { and, eq } from "drizzle-orm";
import { teamMembers, teams, users } from "@yeah/db";
import { db } from "./db";

/**
 * Whether the user belongs to the team — and, when the team requires two-factor authentication, has it
 * turned on. A member without 2FA is locked out of the team's data until they enable it (the owner sees
 * who is affected on the team page).
 */
export async function assertMember(teamId: string, userId: string): Promise<boolean> {
  const rows = await db
    .select({ requireTwoFactor: teams.requireTwoFactor, totpEnabled: users.totpEnabled })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
    .limit(1);
  const row = rows[0];
  if (!row) return false;
  return !row.requireTwoFactor || row.totpEnabled;
}

/** Owner or admin of the team (used for team-wide settings). */
export async function assertTeamAdmin(teamId: string, userId: string): Promise<boolean> {
  const rows = await db.select({ role: teamMembers.role }).from(teamMembers).where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId))).limit(1);
  const role = rows[0]?.role;
  return role === "owner" || role === "admin";
}
