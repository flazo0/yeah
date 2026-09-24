import { Elysia, t } from "elysia";
import { and, eq } from "drizzle-orm";
import { environments, projects, sharedVariables, type SharedVariable } from "@yeah/db";
import { isValidVariableKey, type SharedVariableDto } from "@yeah/shared";
import { db } from "../lib/db";
import { getUserFromSessionId, SESSION_COOKIE } from "../lib/session";
import { assertMember } from "../lib/access";

/** Drizzle wraps the driver error; the Postgres code (23505) or message sits on the error or its cause. */
function isUniqueViolation(err: unknown): boolean {
  const parts: string[] = [];
  for (let e: unknown = err, depth = 0; e && depth < 4; e = (e as { cause?: unknown }).cause, depth++) {
    const { message, code, errno } = e as { message?: string; code?: string; errno?: string };
    parts.push(String(message ?? ""), String(code ?? ""), String(errno ?? ""));
  }
  return /23505|unique|duplicate/i.test(parts.join(" "));
}

function toDto(row: SharedVariable): SharedVariableDto {
  return {
    id: row.id,
    scope: row.scope,
    projectId: row.projectId,
    environmentId: row.environmentId,
    key: row.key,
    value: row.value,
    createdAt: row.createdAt.toISOString(),
  };
}

export const sharedVariableRoutes = new Elysia({ prefix: "/teams/:teamId/variables" })
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
    const rows = await db.select().from(sharedVariables).where(eq(sharedVariables.teamId, params.teamId));
    return { variables: rows.map(toDto) };
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
      if (!isValidVariableKey(body.key)) {
        set.status = 400;
        return { error: "o nome só pode ter letras, números e _ (e não começar com número)" };
      }

      let projectId: string | null = null;
      let environmentId: string | null = null;
      if (body.scope === "project") {
        if (!body.projectId) {
          set.status = 400;
          return { error: "escolha o projeto" };
        }
        const [project] = await db
          .select()
          .from(projects)
          .where(and(eq(projects.id, body.projectId), eq(projects.teamId, params.teamId)))
          .limit(1);
        if (!project) {
          set.status = 404;
          return { error: "projeto não encontrado" };
        }
        projectId = project.id;
      } else if (body.scope === "environment") {
        if (!body.environmentId) {
          set.status = 400;
          return { error: "escolha o ambiente" };
        }
        const [row] = await db
          .select({ environmentId: environments.id })
          .from(environments)
          .innerJoin(projects, eq(projects.id, environments.projectId))
          .where(and(eq(environments.id, body.environmentId), eq(projects.teamId, params.teamId)))
          .limit(1);
        if (!row) {
          set.status = 404;
          return { error: "ambiente não encontrado" };
        }
        environmentId = row.environmentId;
      }

      try {
        const [created] = await db
          .insert(sharedVariables)
          .values({ teamId: params.teamId, scope: body.scope, projectId, environmentId, key: body.key, value: body.value })
          .returning();
        if (!created) {
          set.status = 500;
          return { error: "failed to create variable" };
        }
        return { variable: toDto(created) };
      } catch (err) {
        if (isUniqueViolation(err)) {
          set.status = 409;
          return { error: "já existe uma variável com esse nome nesse escopo" };
        }
        throw err;
      }
    },
    {
      body: t.Object({
        scope: t.Union([t.Literal("team"), t.Literal("project"), t.Literal("environment")]),
        projectId: t.Optional(t.String()),
        environmentId: t.Optional(t.String()),
        key: t.String({ minLength: 1, maxLength: 255 }),
        value: t.String({ maxLength: 20000 }),
      }),
    },
  )
  .put(
    "/:variableId",
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
      const [updated] = await db
        .update(sharedVariables)
        .set({ value: body.value })
        .where(and(eq(sharedVariables.id, params.variableId), eq(sharedVariables.teamId, params.teamId)))
        .returning();
      if (!updated) {
        set.status = 404;
        return { error: "variable not found" };
      }
      return { variable: toDto(updated) };
    },
    { body: t.Object({ value: t.String({ maxLength: 20000 }) }) },
  )
  .delete("/:variableId", async ({ cookie, params, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    if (!(await assertMember(params.teamId, user.id))) {
      set.status = 403;
      return { error: "forbidden" };
    }
    const deleted = await db
      .delete(sharedVariables)
      .where(and(eq(sharedVariables.id, params.variableId), eq(sharedVariables.teamId, params.teamId)))
      .returning({ id: sharedVariables.id });
    if (deleted.length === 0) {
      set.status = 404;
      return { error: "variable not found" };
    }
    return { ok: true };
  });
