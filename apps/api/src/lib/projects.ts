import { and, eq } from "drizzle-orm";
import { environments, projects } from "@yeah/db";
import { db } from "./db";

/** Every team gets a "Default" project with a "production" environment so there's always
 * somewhere to put a resource — matches how Coolify seeds a first project on signup. */
export async function createDefaultProject(teamId: string) {
  const [project] = await db.insert(projects).values({ teamId, name: "Default" }).returning();
  if (!project) return null;
  const [environment] = await db.insert(environments).values({ projectId: project.id, name: "production" }).returning();
  return { project, environment };
}

export async function loadProject(teamId: string, projectId: string) {
  const rows = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.teamId, teamId)))
    .limit(1);
  return rows[0];
}

/** Verifies the whole chain (team → project → environment) belongs together before any resource route trusts it. */
export async function loadEnvironment(teamId: string, projectId: string, environmentId: string) {
  const project = await loadProject(teamId, projectId);
  if (!project) return null;
  const rows = await db
    .select()
    .from(environments)
    .where(and(eq(environments.id, environmentId), eq(environments.projectId, projectId)))
    .limit(1);
  const environment = rows[0];
  if (!environment) return null;
  return { project, environment };
}
