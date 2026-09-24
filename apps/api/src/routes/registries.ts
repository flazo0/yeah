import { Elysia, t } from "elysia";
import { and, eq } from "drizzle-orm";
import { registries, type Registry } from "@yeah/db";
import { isValidRegistryHost, isValidRegistryUsername, type RegistryDto } from "@yeah/shared";
import { db } from "../lib/db";
import { getUserFromSessionId, SESSION_COOKIE } from "../lib/session";
import { assertMember } from "../lib/access";

function isUniqueViolation(err: unknown): boolean {
  const parts: string[] = [];
  for (let e: unknown = err, depth = 0; e && depth < 4; e = (e as { cause?: unknown }).cause, depth++) {
    const { message, code } = e as { message?: string; code?: string };
    parts.push(String(message ?? ""), String(code ?? ""));
  }
  return /23505|unique|duplicate/i.test(parts.join(" "));
}

function toDto(r: Registry): RegistryDto {
  return { id: r.id, name: r.name, host: r.host, username: r.username, hasPassword: r.password.length > 0, createdAt: r.createdAt.toISOString() };
}

/** Accepts "https://ghcr.io/" and returns "ghcr.io" — people paste URLs. */
function normalizeHost(input: string): string {
  return input.trim().replace(/^[a-z]+:\/\//i, "").replace(/\/.*$/, "").toLowerCase();
}

export const registryRoutes = new Elysia({ prefix: "/teams/:teamId/registries" })
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
    const rows = await db.select().from(registries).where(eq(registries.teamId, params.teamId)).orderBy(registries.name);
    return { registries: rows.map(toDto) };
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
      const host = normalizeHost(body.host);
      if (!isValidRegistryHost(host)) {
        set.status = 400;
        return { error: "endereço do registry inválido (ex.: ghcr.io ou registry.exemplo.com:5000)" };
      }
      if (!isValidRegistryUsername(body.username)) {
        set.status = 400;
        return { error: "usuário inválido" };
      }
      if (!body.name.trim() || !body.password) {
        set.status = 400;
        return { error: "informe nome e senha/token" };
      }
      try {
        const [row] = await db.insert(registries).values({ teamId: params.teamId, name: body.name.trim(), host, username: body.username, password: body.password }).returning();
        return { registry: toDto(row!) };
      } catch (err) {
        if (isUniqueViolation(err)) {
          set.status = 409;
          return { error: "já existe um registry com esse nome" };
        }
        throw err;
      }
    },
    { body: t.Object({ name: t.String({ maxLength: 255 }), host: t.String({ maxLength: 300 }), username: t.String({ maxLength: 255 }), password: t.String({ maxLength: 4096 }) }) },
  )
  .put(
    "/:registryId",
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
      const patch: Partial<typeof registries.$inferInsert> = {};
      if (body.name !== undefined) patch.name = body.name.trim();
      if (body.host !== undefined) {
        const host = normalizeHost(body.host);
        if (!isValidRegistryHost(host)) {
          set.status = 400;
          return { error: "endereço do registry inválido" };
        }
        patch.host = host;
      }
      if (body.username !== undefined) {
        if (!isValidRegistryUsername(body.username)) {
          set.status = 400;
          return { error: "usuário inválido" };
        }
        patch.username = body.username;
      }
      // Empty means "keep the stored password" — the form never gets the old one back to resubmit.
      if (body.password) patch.password = body.password;
      if (Object.keys(patch).length === 0) {
        const [current] = await db.select().from(registries).where(and(eq(registries.id, params.registryId), eq(registries.teamId, params.teamId))).limit(1);
        if (!current) {
          set.status = 404;
          return { error: "registry not found" };
        }
        return { registry: toDto(current) };
      }
      try {
        const [row] = await db.update(registries).set(patch).where(and(eq(registries.id, params.registryId), eq(registries.teamId, params.teamId))).returning();
        if (!row) {
          set.status = 404;
          return { error: "registry not found" };
        }
        return { registry: toDto(row) };
      } catch (err) {
        if (isUniqueViolation(err)) {
          set.status = 409;
          return { error: "já existe um registry com esse nome" };
        }
        throw err;
      }
    },
    { body: t.Object({ name: t.Optional(t.String({ maxLength: 255 })), host: t.Optional(t.String({ maxLength: 300 })), username: t.Optional(t.String({ maxLength: 255 })), password: t.Optional(t.String({ maxLength: 4096 })) }) },
  )
  .delete("/:registryId", async ({ cookie, params, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    if (!(await assertMember(params.teamId, user.id))) {
      set.status = 403;
      return { error: "forbidden" };
    }
    const deleted = await db.delete(registries).where(and(eq(registries.id, params.registryId), eq(registries.teamId, params.teamId))).returning({ id: registries.id });
    if (deleted.length === 0) {
      set.status = 404;
      return { error: "registry not found" };
    }
    // Applications that used it keep working for images that are already local; their registry link is cleared (FK set null).
    return { ok: true };
  });
