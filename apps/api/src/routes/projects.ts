import { Elysia, t } from "elysia";
import { eq, sql } from "drizzle-orm";
import { applications, databases, environments, projects, services } from "@yeah/db";
import type { EnvironmentDto, ProjectDto } from "@yeah/shared";
import { db } from "../lib/db";
import { getUserFromSessionId, SESSION_COOKIE } from "../lib/session";
import { assertMember } from "../lib/access";
import { loadEnvironment, loadProject } from "../lib/projects";

export const projectRoutes = new Elysia({ prefix: "/teams/:teamId/projects" })
  .get("/", async ({ cookie, params, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    if (!(await assertMember(params.teamId, user.id))) {
      set.status = 403;
      return { error: "forbidden" };
    }

    const rows = await db
      .select({
        project: projects,
        environmentCount: sql<number>`count(distinct ${environments.id})::int`,
      })
      .from(projects)
      .leftJoin(environments, eq(environments.projectId, projects.id))
      .where(eq(projects.teamId, params.teamId))
      .groupBy(projects.id);

    const result: ProjectDto[] = rows.map((row) => ({
      id: row.project.id,
      teamId: row.project.teamId,
      name: row.project.name,
      environmentCount: row.environmentCount,
      createdAt: row.project.createdAt.toISOString(),
    }));

    return { projects: result };
  })
  .post(
    "/",
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

      const [project] = await db.insert(projects).values({ teamId: params.teamId, name: body.name }).returning();
      if (!project) {
        set.status = 500;
        return { error: "failed to create project" };
      }
      const [environment] = await db
        .insert(environments)
        .values({ projectId: project.id, name: body.firstEnvironmentName ?? "production" })
        .returning();

      const dto: ProjectDto = {
        id: project.id,
        teamId: project.teamId,
        name: project.name,
        environmentCount: environment ? 1 : 0,
        createdAt: project.createdAt.toISOString(),
      };
      return { project: dto };
    },
    { body: t.Object({ name: t.String({ minLength: 1 }), firstEnvironmentName: t.Optional(t.String()) }) },
  )
  .get("/:projectId", async ({ cookie, params, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    if (!(await assertMember(params.teamId, user.id))) {
      set.status = 403;
      return { error: "forbidden" };
    }

    const project = await loadProject(params.teamId, params.projectId);
    if (!project) {
      set.status = 404;
      return { error: "project not found" };
    }

    const environmentRows = await db.select().from(environments).where(eq(environments.projectId, project.id));

    const dto: ProjectDto = {
      id: project.id,
      teamId: project.teamId,
      name: project.name,
      environmentCount: environmentRows.length,
      createdAt: project.createdAt.toISOString(),
    };
    return { project: dto };
  })
  // Just the names needed to render a breadcrumb (Project › Environment › resource) on every
  // resource detail page — those routes already carry teamId/projectId/environmentId, so this
  // is the one extra call each of them makes instead of duplicating project/environment name
  // joins into every Application/Database/Service route.
  .get("/:projectId/environments/:environmentId", async ({ cookie, params, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    if (!(await assertMember(params.teamId, user.id))) {
      set.status = 403;
      return { error: "forbidden" };
    }

    const loaded = await loadEnvironment(params.teamId, params.projectId, params.environmentId);
    if (!loaded) {
      set.status = 404;
      return { error: "environment not found" };
    }

    return {
      project: { id: loaded.project.id, name: loaded.project.name },
      environment: { id: loaded.environment.id, name: loaded.environment.name },
    };
  })
  .get("/:projectId/environments", async ({ cookie, params, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    if (!(await assertMember(params.teamId, user.id))) {
      set.status = 403;
      return { error: "forbidden" };
    }
    if (!(await loadProject(params.teamId, params.projectId))) {
      set.status = 404;
      return { error: "project not found" };
    }

    const rows = await db
      .select({
        environment: environments,
        applicationCount: sql<number>`count(distinct ${applications.id})::int`,
        databaseCount: sql<number>`count(distinct ${databases.id})::int`,
        serviceCount: sql<number>`count(distinct ${services.id})::int`,
      })
      .from(environments)
      .leftJoin(applications, eq(applications.environmentId, environments.id))
      .leftJoin(databases, eq(databases.environmentId, environments.id))
      .leftJoin(services, eq(services.environmentId, environments.id))
      .where(eq(environments.projectId, params.projectId))
      .groupBy(environments.id);

    const result: EnvironmentDto[] = rows.map((row) => ({
      id: row.environment.id,
      projectId: row.environment.projectId,
      name: row.environment.name,
      applicationCount: row.applicationCount,
      databaseCount: row.databaseCount,
      serviceCount: row.serviceCount,
      createdAt: row.environment.createdAt.toISOString(),
    }));

    return { environments: result };
  })
  .post(
    "/:projectId/environments",
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
      if (!(await loadProject(params.teamId, params.projectId))) {
        set.status = 404;
        return { error: "project not found" };
      }

      const [environment] = await db
        .insert(environments)
        .values({ projectId: params.projectId, name: body.name })
        .returning();
      if (!environment) {
        set.status = 500;
        return { error: "failed to create environment" };
      }

      const dto: EnvironmentDto = {
        id: environment.id,
        projectId: environment.projectId,
        name: environment.name,
        applicationCount: 0,
        databaseCount: 0,
        serviceCount: 0,
        createdAt: environment.createdAt.toISOString(),
      };
      return { environment: dto };
    },
    { body: t.Object({ name: t.String({ minLength: 1 }) }) },
  );
