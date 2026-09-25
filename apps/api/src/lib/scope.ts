import { and, eq } from "drizzle-orm";
import { environments, projects } from "@yeah/db";
import { db } from "./db";

/**
 * Every resource route lives under /teams/:teamId/projects/:projectId/environments/:environmentId.
 * Membership is checked against the team in the URL, so without this the *rest* of the path could point
 * at another team's project or environment and the resource lookups (which only filter by environment)
 * would happily return it. This runs first and answers 404 unless the whole chain belongs together.
 */
export async function requireEnvironmentScope({ params, set }: { params: Record<string, string | undefined>; set: { status?: number | string } }) {
  const { teamId, projectId, environmentId } = params;
  if (!teamId || !projectId || !environmentId) return;
  const [row] = await db
    .select({ id: environments.id })
    .from(environments)
    .innerJoin(projects, eq(environments.projectId, projects.id))
    .where(and(eq(environments.id, environmentId), eq(projects.id, projectId), eq(projects.teamId, teamId)))
    .limit(1)
    .catch(() => []); // a malformed uuid is just "not found"
  if (row) return;
  set.status = 404;
  return { error: "not found" };
}
