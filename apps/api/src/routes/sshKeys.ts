import { Elysia, t } from "elysia";
import { and, count, eq } from "drizzle-orm";
import { servers, sshKeys, type SshKey } from "@yeah/db";
import type { SshKeyDto } from "@yeah/shared";
import { generateSshKeyPair } from "@yeah/ssh";
import { db } from "../lib/db";
import { getUserFromSessionId, SESSION_COOKIE } from "../lib/session";
import { assertMember } from "../lib/access";

// Keys & Tokens — SSH keys: generate or import once, reuse when adding a server or a private-repo
// deploy key. The private key is written here and read back only by the server/application create
// routes (never returned to the browser) — see servers.ts (sshKeyId) and applications.ts (deployKeySshKeyId).

const PUBLIC_KEY_LINE = /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-\S+)\s+\S+/;

async function usageCount(keyId: string): Promise<number> {
  const [row] = await db.select({ n: count() }).from(servers).where(eq(servers.sshKeyId, keyId));
  return row?.n ?? 0;
}

async function toDto(k: SshKey): Promise<SshKeyDto> {
  return { id: k.id, teamId: k.teamId, name: k.name, publicKey: k.publicKey, serversUsing: await usageCount(k.id), createdAt: k.createdAt.toISOString() };
}

export const sshKeyRoutes = new Elysia({ prefix: "/teams/:teamId/ssh-keys" })
  .derive(async ({ cookie, params }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) return { kctx: { error: "unauthorized" as const, status: 401 } };
    if (!(await assertMember(params.teamId, user.id))) return { kctx: { error: "forbidden" as const, status: 403 } };
    return { kctx: {} };
  })
  .get("/", async ({ kctx, params, set }) => {
    if ("error" in kctx) {
      set.status = kctx.status;
      return { error: kctx.error };
    }
    const rows = await db.select().from(sshKeys).where(eq(sshKeys.teamId, params.teamId));
    return { keys: await Promise.all(rows.map(toDto)) };
  })
  .post(
    "/generate",
    async ({ kctx, params, body, set }) => {
      if ("error" in kctx) {
        set.status = kctx.status;
        return { error: kctx.error };
      }
      const pair = generateSshKeyPair(body.name);
      const [existing] = await db.select({ id: sshKeys.id }).from(sshKeys).where(and(eq(sshKeys.teamId, params.teamId), eq(sshKeys.name, body.name))).limit(1);
      if (existing) {
        set.status = 409;
        return { error: "já existe uma chave com esse nome" };
      }
      const [key] = await db.insert(sshKeys).values({ teamId: params.teamId, name: body.name, privateKey: pair.privateKey, publicKey: pair.publicKey }).returning();
      return { key: await toDto(key!) };
    },
    { body: t.Object({ name: t.String({ minLength: 1, maxLength: 255 }) }) },
  )
  .post(
    "/import",
    async ({ kctx, params, body, set }) => {
      if ("error" in kctx) {
        set.status = kctx.status;
        return { error: kctx.error };
      }
      if (!body.privateKey.includes("PRIVATE KEY")) {
        set.status = 400;
        return { error: "isso não parece uma chave privada (esperado um bloco -----BEGIN ... PRIVATE KEY-----)" };
      }
      if (!PUBLIC_KEY_LINE.test(body.publicKey.trim())) {
        set.status = 400;
        return { error: "isso não parece uma chave pública (esperado algo como \"ssh-ed25519 AAAA... comentário\")" };
      }
      const [existing] = await db.select({ id: sshKeys.id }).from(sshKeys).where(and(eq(sshKeys.teamId, params.teamId), eq(sshKeys.name, body.name))).limit(1);
      if (existing) {
        set.status = 409;
        return { error: "já existe uma chave com esse nome" };
      }
      const [key] = await db.insert(sshKeys).values({ teamId: params.teamId, name: body.name, privateKey: body.privateKey.trim() + "\n", publicKey: body.publicKey.trim() }).returning();
      return { key: await toDto(key!) };
    },
    { body: t.Object({ name: t.String({ minLength: 1, maxLength: 255 }), privateKey: t.String({ minLength: 1 }), publicKey: t.String({ minLength: 1 }) }) },
  )
  .delete("/:keyId", async ({ kctx, params, set }) => {
    if ("error" in kctx) {
      set.status = kctx.status;
      return { error: kctx.error };
    }
    const [key] = await db.select().from(sshKeys).where(and(eq(sshKeys.id, params.keyId), eq(sshKeys.teamId, params.teamId))).limit(1);
    if (!key) {
      set.status = 404;
      return { error: "ssh key not found" };
    }
    const used = await usageCount(key.id);
    if (used > 0) {
      set.status = 409;
      return { error: `essa chave está em uso por ${used} servidor${used > 1 ? "es" : ""} — troque a chave deles antes de excluir` };
    }
    await db.delete(sshKeys).where(eq(sshKeys.id, key.id));
    return { ok: true };
  });
