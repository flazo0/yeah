import { Elysia, t } from "elysia";
import { eq } from "drizzle-orm";
import { users, teams, teamMembers, type User } from "@yeah/db";
import type { SafeUser } from "@yeah/shared";
import { db } from "../lib/db";
import { hashPassword, verifyPassword } from "../lib/password";
import { createSession, destroySession, getUserFromSessionId, SESSION_COOKIE } from "../lib/session";
import { createDefaultProject } from "../lib/projects";

function toSafeUser(user: User): SafeUser {
  return { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt.toISOString() };
}

export const authRoutes = new Elysia({ prefix: "/auth" })
  .post(
    "/register",
    async ({ body, cookie, set }) => {
      const existing = await db.select().from(users).where(eq(users.email, body.email)).limit(1);
      if (existing[0]) {
        set.status = 409;
        return { error: "email already registered" };
      }

      const passwordHash = await hashPassword(body.password);
      const [user] = await db
        .insert(users)
        .values({ email: body.email, passwordHash, name: body.name ?? null })
        .returning();
      if (!user) {
        set.status = 500;
        return { error: "failed to create user" };
      }

      const [team] = await db
        .insert(teams)
        .values({ name: body.name ? `${body.name}'s team` : "Personal", personal: true })
        .returning();
      if (team) {
        await db.insert(teamMembers).values({ teamId: team.id, userId: user.id, role: "owner" });
        await createDefaultProject(team.id);
      }

      const session = await createSession(user.id);
      cookie[SESSION_COOKIE]?.set({
        value: session.id,
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        expires: session.expiresAt,
      });

      return { user: toSafeUser(user) };
    },
    {
      body: t.Object({
        email: t.String({ format: "email" }),
        password: t.String({ minLength: 8 }),
        name: t.Optional(t.String()),
      }),
    },
  )
  .post(
    "/login",
    async ({ body, cookie, set }) => {
      const rows = await db.select().from(users).where(eq(users.email, body.email)).limit(1);
      const user = rows[0];
      if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
        set.status = 401;
        return { error: "invalid credentials" };
      }

      const session = await createSession(user.id);
      cookie[SESSION_COOKIE]?.set({
        value: session.id,
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        expires: session.expiresAt,
      });

      return { user: toSafeUser(user) };
    },
    {
      body: t.Object({
        email: t.String({ format: "email" }),
        password: t.String(),
      }),
    },
  )
  .post("/logout", async ({ cookie, set }) => {
    await destroySession(cookie[SESSION_COOKIE]?.value);
    cookie[SESSION_COOKIE]?.remove();
    set.status = 204;
  })
  .get("/me", async ({ cookie, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    return { user: toSafeUser(user) };
  });
