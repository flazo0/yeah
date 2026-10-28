import { Elysia, t } from "elysia";
import { and, eq } from "drizzle-orm";
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from "@simplewebauthn/server";
import type { AuthenticationResponseJSON, AuthenticatorTransport, RegistrationResponseJSON } from "@simplewebauthn/server";
import { passkeys, users } from "@yeah/db";
import { db } from "../lib/db";
import { createSession, getUserFromSessionId, SESSION_COOKIE, sessionCookieOptions } from "../lib/session";
import { challenges, relyingParty } from "../lib/webauthnChallenges";

// Passkeys (WebAuthn): register one or more from the profile, then sign in with it instead of password + 2FA.
// The relying party is the hostname the panel is served from (must be one of WEB_ORIGIN), so a passkey only
// works on the address it was created for - set WEB_ORIGIN to the real panel URL when using a domain.

const RP_NAME = "yeah";
const CHALLENGE_COOKIE = "yeah_webauthn";

const webOrigins = () =>
  (process.env.WEB_ORIGIN ?? "http://localhost:5173,http://localhost:5174")
    .split(",")
    .map((o) => o.trim());

const toBase64Url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const fromBase64Url = (value: string) => new Uint8Array(Buffer.from(value, "base64url"));

function parseTransports(value: string | null): AuthenticatorTransport[] | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as AuthenticatorTransport[]) : undefined;
  } catch {
    return undefined;
  }
}

export const passkeyRoutes = new Elysia({ prefix: "/auth/passkeys" })
  .get("/", async ({ cookie, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    const rows = await db.select().from(passkeys).where(eq(passkeys.userId, user.id));
    return { passkeys: rows.map((p) => ({ id: p.id, name: p.name, createdAt: p.createdAt.toISOString(), lastUsedAt: p.lastUsedAt ? p.lastUsedAt.toISOString() : null })) };
  })
  .post("/register/options", async ({ cookie, request, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    const rp = relyingParty(request.headers.get("origin"), webOrigins());
    if (!rp) {
      set.status = 400;
      return { error: "este endereço não está em WEB_ORIGIN — passkeys só funcionam no endereço configurado do painel" };
    }
    const existing = await db.select().from(passkeys).where(eq(passkeys.userId, user.id));
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: rp.rpID,
      userName: user.email,
      userID: new Uint8Array(Buffer.from(user.id, "utf8")),
      attestationType: "none",
      excludeCredentials: existing.map((p) => ({ id: p.credentialId, transports: parseTransports(p.transports) })),
      authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
    });
    challenges.put(`reg:${user.id}`, options.challenge);
    return options;
  })
  .post(
    "/register/verify",
    async ({ cookie, request, body, set }) => {
      const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
      if (!user) {
        set.status = 401;
        return { error: "unauthorized" };
      }
      const rp = relyingParty(request.headers.get("origin"), webOrigins());
      const expectedChallenge = challenges.take(`reg:${user.id}`);
      if (!rp || !expectedChallenge) {
        set.status = 400;
        return { error: "o pedido de cadastro expirou — tente de novo" };
      }
      try {
        const verification = await verifyRegistrationResponse({
          response: body.response as unknown as RegistrationResponseJSON,
          expectedChallenge,
          expectedOrigin: rp.origin,
          expectedRPID: rp.rpID,
        });
        if (!verification.verified || !verification.registrationInfo) {
          set.status = 400;
          return { error: "não foi possível verificar a passkey" };
        }
        const { credential } = verification.registrationInfo;
        await db.insert(passkeys).values({
          userId: user.id,
          name: body.name.trim() || "Passkey",
          credentialId: credential.id,
          publicKey: toBase64Url(credential.publicKey),
          counter: credential.counter,
          transports: credential.transports ? JSON.stringify(credential.transports) : null,
        });
        return { ok: true };
      } catch (err) {
        set.status = 400;
        return { error: `não foi possível verificar a passkey: ${err instanceof Error ? err.message : "erro"}` };
      }
    },
    { body: t.Object({ name: t.String({ maxLength: 100 }), response: t.Any() }) },
  )
  .delete("/:passkeyId", async ({ cookie, params, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    await db.delete(passkeys).where(and(eq(passkeys.id, params.passkeyId), eq(passkeys.userId, user.id)));
    return { ok: true };
  })
  // --- sign-in (no session yet) ---
  .post("/login/options", async ({ cookie, request, set }) => {
    const rp = relyingParty(request.headers.get("origin"), webOrigins());
    if (!rp) {
      set.status = 400;
      return { error: "este endereço não está em WEB_ORIGIN" };
    }
    // Discoverable credentials: no allowCredentials, the browser offers the passkeys it has for this site.
    const options = await generateAuthenticationOptions({ rpID: rp.rpID, userVerification: "preferred" });
    const key = crypto.randomUUID();
    challenges.put(`auth:${key}`, options.challenge);
    cookie[CHALLENGE_COOKIE]?.set({ value: key, httpOnly: true, sameSite: "lax", path: "/", maxAge: 300 });
    return options;
  })
  .post(
    "/login/verify",
    async ({ cookie, request, body, set }) => {
      const rp = relyingParty(request.headers.get("origin"), webOrigins());
      const key = cookie[CHALLENGE_COOKIE]?.value;
      const expectedChallenge = typeof key === "string" ? challenges.take(`auth:${key}`) : null;
      cookie[CHALLENGE_COOKIE]?.remove();
      if (!rp || !expectedChallenge) {
        set.status = 400;
        return { error: "o pedido de login expirou — tente de novo" };
      }
      const response = body.response as unknown as AuthenticationResponseJSON;
      const [stored] = await db.select().from(passkeys).where(eq(passkeys.credentialId, response.id)).limit(1);
      if (!stored) {
        set.status = 401;
        return { error: "passkey não reconhecida" };
      }
      try {
        const verification = await verifyAuthenticationResponse({
          response,
          expectedChallenge,
          expectedOrigin: rp.origin,
          expectedRPID: rp.rpID,
          credential: { id: stored.credentialId, publicKey: fromBase64Url(stored.publicKey), counter: stored.counter, transports: parseTransports(stored.transports) },
        });
        if (!verification.verified) {
          set.status = 401;
          return { error: "passkey inválida" };
        }
        await db.update(passkeys).set({ counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() }).where(eq(passkeys.id, stored.id));
        const [user] = await db.select().from(users).where(eq(users.id, stored.userId)).limit(1);
        if (!user) {
          set.status = 401;
          return { error: "usuário não encontrado" };
        }
        const session = await createSession(user.id);
        cookie[SESSION_COOKIE]?.set({ value: session.id, ...sessionCookieOptions(session.expiresAt) });
        return { user: { id: user.id, email: user.email } };
      } catch (err) {
        set.status = 401;
        return { error: `passkey inválida: ${err instanceof Error ? err.message : "erro"}` };
      }
    },
    { body: t.Object({ response: t.Any() }) },
  );
