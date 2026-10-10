import { Elysia, t } from "elysia";
import { eq } from "drizzle-orm";
import { users, teams, teamMembers, type User } from "@yeah/db";
import type { SafeUser } from "@yeah/shared";
import { db } from "../lib/db";
import { hashPassword, verifyPassword } from "../lib/password";
import { createSession, destroySession, getUserFromSessionId, sessionCookieOptions, SESSION_COOKIE } from "../lib/session";
import { generateRecoveryCodes, generateTotpSecret, hashRecoveryCode, otpauthUri, verifyTotp } from "../lib/totp";
import { createDefaultProject } from "../lib/projects";
import { createLocalhostServerIfConfigured } from "../lib/localhostServer";

function toSafeUser(user: User): SafeUser {
  return { id: user.id, email: user.email, name: user.name, totpEnabled: user.totpEnabled, createdAt: user.createdAt.toISOString() };
}

/** A valid authenticator code, or an unused recovery code (which is consumed). */
async function checkSecondFactor(user: User, code: string): Promise<boolean> {
  if (user.totpSecret && verifyTotp(user.totpSecret, code.trim())) return true;
  const hashes: string[] = user.totpRecoveryHashes ? JSON.parse(user.totpRecoveryHashes) : [];
  const hash = hashRecoveryCode(code);
  if (!hashes.includes(hash)) return false;
  await db.update(users).set({ totpRecoveryHashes: JSON.stringify(hashes.filter((h) => h !== hash)) }).where(eq(users.id, user.id));
  return true;
}

/** yeah is single-admin, not a multi-tenant signup product — registration only works to create
 * that one account. Once it exists, this is the only thing standing between "/register" and
 * anyone with the URL creating themselves a login, so it's checked first, before anything else. */
async function hasAnyUser(): Promise<boolean> {
  const rows = await db.select({ id: users.id }).from(users).limit(1);
  return rows.length > 0;
}

export const authRoutes = new Elysia({ prefix: "/auth" })
  .get("/setup-status", async () => {
    return { needsSetup: !(await hasAnyUser()) };
  })
  .post(
    "/register",
    async ({ body, cookie, set }) => {
      if (await hasAnyUser()) {
        set.status = 403;
        return { error: "cadastro desabilitado — essa instância já tem uma conta" };
      }

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
        await createLocalhostServerIfConfigured(team.id);
      }

      const session = await createSession(user.id);
      cookie[SESSION_COOKIE]?.set({ value: session.id, ...sessionCookieOptions(session.expiresAt) });

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

      if (user.totpEnabled && user.totpSecret) {
        if (!body.code) {
          set.status = 401;
          return { error: "informe o código de verificação em duas etapas", code: "totp_required" };
        }
        if (!(await checkSecondFactor(user, body.code))) {
          set.status = 401;
          return { error: "código inválido", code: "totp_invalid" };
        }
      }

      const session = await createSession(user.id);
      cookie[SESSION_COOKIE]?.set({ value: session.id, ...sessionCookieOptions(session.expiresAt) });

      return { user: toSafeUser(user) };
    },
    {
      body: t.Object({
        email: t.String({ format: "email" }),
        password: t.String(),
        code: t.Optional(t.String()),
      }),
    },
  )
  .post("/2fa/setup", async ({ cookie, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    if (user.totpEnabled) {
      set.status = 409;
      return { error: "a verificação em duas etapas já está ativa" };
    }
    // Stored but inert until /2fa/enable proves the authenticator app actually has it.
    const secret = generateTotpSecret();
    await db.update(users).set({ totpSecret: secret }).where(eq(users.id, user.id));
    return { secret, otpauthUri: otpauthUri(secret, user.email) };
  })
  .post(
    "/2fa/enable",
    async ({ cookie, body, set }) => {
      const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
      if (!user) {
        set.status = 401;
        return { error: "unauthorized" };
      }
      if (user.totpEnabled || !user.totpSecret) {
        set.status = 409;
        return { error: "inicie a configuração de novo" };
      }
      if (!verifyTotp(user.totpSecret, body.code)) {
        set.status = 400;
        return { error: "código inválido" };
      }
      const recoveryCodes = generateRecoveryCodes();
      await db
        .update(users)
        .set({ totpEnabled: true, totpRecoveryHashes: JSON.stringify(recoveryCodes.map(hashRecoveryCode)) })
        .where(eq(users.id, user.id));
      // Shown once — only the hashes are kept.
      return { recoveryCodes };
    },
    { body: t.Object({ code: t.String() }) },
  )
  .post(
    "/2fa/disable",
    async ({ cookie, body, set }) => {
      const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
      if (!user) {
        set.status = 401;
        return { error: "unauthorized" };
      }
      if (!user.totpEnabled) return { ok: true };
      if (!(await verifyPassword(body.password, user.passwordHash)) || !(await checkSecondFactor(user, body.code))) {
        set.status = 400;
        return { error: "senha ou código inválido" };
      }
      await db.update(users).set({ totpEnabled: false, totpSecret: null, totpRecoveryHashes: null }).where(eq(users.id, user.id));
      return { ok: true };
    },
    { body: t.Object({ password: t.String(), code: t.String() }) },
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

