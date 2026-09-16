import { and, eq } from "drizzle-orm";
import { teamMembers } from "@yeah/db";
import { db } from "./db";

export async function assertMember(teamId: string, userId: string): Promise<boolean> {
  const rows = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
    .limit(1);
  return Boolean(rows[0]);
}
