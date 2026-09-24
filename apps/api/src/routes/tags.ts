import { Elysia, t } from "elysia";
import { and, eq, inArray } from "drizzle-orm";
import { applications, databases, resourceTags, services, tags } from "@yeah/db";
import type { TagDto, TaggableType } from "@yeah/shared";
import { db } from "../lib/db";
import { getUserFromSessionId, SESSION_COOKIE } from "../lib/session";
import { assertMember } from "../lib/access";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const TYPE_SCHEMA = t.Union([t.Literal("application"), t.Literal("database"), t.Literal("service")]);

function isUniqueViolation(err: unknown): boolean {
  const parts: string[] = [];
  for (let e: unknown = err, depth = 0; e && depth < 4; e = (e as { cause?: unknown }).cause, depth++) {
    const { message, code } = e as { message?: string; code?: string };
    parts.push(String(message ?? ""), String(code ?? ""));
  }
  return /23505|unique|duplicate/i.test(parts.join(" "));
}

async function resourceBelongsToTeam(type: TaggableType, id: string, teamId: string): Promise<boolean> {
  const table = type === "application" ? applications : type === "database" ? databases : services;
  const [row] = await db.select({ id: table.id }).from(table).where(and(eq(table.id, id), eq(table.teamId, teamId))).limit(1);
  return Boolean(row);
}

async function loadTags(teamId: string): Promise<TagDto[]> {
  const rows = await db.select().from(tags).where(eq(tags.teamId, teamId)).orderBy(tags.name);
  const links = rows.length ? await db.select().from(resourceTags).where(inArray(resourceTags.tagId, rows.map((r) => r.id))) : [];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    color: r.color,
    resources: links.filter((l) => l.tagId === r.id).map((l) => ({ type: l.resourceType, id: l.resourceId })),
  }));
}

export const tagRoutes = new Elysia({ prefix: "/teams/:teamId/tags" })
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
    return { tags: await loadTags(params.teamId) };
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
      const name = body.name.trim();
      if (!name) {
        set.status = 400;
        return { error: "a etiqueta precisa de um nome" };
      }
      if (body.color && !HEX_COLOR.test(body.color)) {
        set.status = 400;
        return { error: "cor inválida (use #rrggbb)" };
      }
      try {
        const [row] = await db
          .insert(tags)
          .values({ teamId: params.teamId, name, ...(body.color ? { color: body.color } : {}) })
          .returning();
        return { tag: { id: row!.id, name: row!.name, color: row!.color, resources: [] } satisfies TagDto };
      } catch (err) {
        if (isUniqueViolation(err)) {
          set.status = 409;
          return { error: "já existe uma etiqueta com esse nome" };
        }
        throw err;
      }
    },
    { body: t.Object({ name: t.String({ maxLength: 50 }), color: t.Optional(t.String()) }) },
  )
  .put(
    "/assign",
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
      if (!(await resourceBelongsToTeam(body.resourceType, body.resourceId, params.teamId))) {
        set.status = 404;
        return { error: "resource not found" };
      }
      const wanted = [...new Set(body.tagIds)];
      const owned = wanted.length ? await db.select({ id: tags.id }).from(tags).where(and(eq(tags.teamId, params.teamId), inArray(tags.id, wanted))) : [];
      if (owned.length !== wanted.length) {
        set.status = 400;
        return { error: "etiqueta inválida" };
      }
      // Replace the resource's tag set; only this team's tags can be touched.
      const teamTagIds = (await db.select({ id: tags.id }).from(tags).where(eq(tags.teamId, params.teamId))).map((r) => r.id);
      if (teamTagIds.length) {
        await db
          .delete(resourceTags)
          .where(and(eq(resourceTags.resourceType, body.resourceType), eq(resourceTags.resourceId, body.resourceId), inArray(resourceTags.tagId, teamTagIds)));
      }
      if (wanted.length) {
        await db.insert(resourceTags).values(wanted.map((tagId) => ({ tagId, resourceType: body.resourceType, resourceId: body.resourceId })));
      }
      return { tags: await loadTags(params.teamId) };
    },
    { body: t.Object({ resourceType: TYPE_SCHEMA, resourceId: t.String(), tagIds: t.Array(t.String()) }) },
  )
  .put(
    "/:tagId",
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
      if (!name || (body.color && !HEX_COLOR.test(body.color))) {
        set.status = 400;
        return { error: "nome ou cor inválidos" };
      }
      try {
        const [row] = await db
          .update(tags)
          .set({ name, ...(body.color ? { color: body.color } : {}) })
          .where(and(eq(tags.id, params.tagId), eq(tags.teamId, params.teamId)))
          .returning();
        if (!row) {
          set.status = 404;
          return { error: "tag not found" };
        }
        return { tags: await loadTags(params.teamId) };
      } catch (err) {
        if (isUniqueViolation(err)) {
          set.status = 409;
          return { error: "já existe uma etiqueta com esse nome" };
        }
        throw err;
      }
    },
    { body: t.Object({ name: t.String({ maxLength: 50 }), color: t.Optional(t.String()) }) },
  )
  .delete("/:tagId", async ({ cookie, params, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    if (!(await assertMember(params.teamId, user.id))) {
      set.status = 403;
      return { error: "forbidden" };
    }
    const deleted = await db.delete(tags).where(and(eq(tags.id, params.tagId), eq(tags.teamId, params.teamId))).returning({ id: tags.id });
    if (deleted.length === 0) {
      set.status = 404;
      return { error: "tag not found" };
    }
    return { ok: true };
  });
