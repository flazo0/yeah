import { Elysia, t } from "elysia";
import { and, eq } from "drizzle-orm";
import { caCertificates, servers, type CaCertificate } from "@yeah/db";
import type { CaCertificateDto } from "@yeah/shared";
import { db } from "../lib/db";
import { getUserFromSessionId, SESSION_COOKIE } from "../lib/session";
import { assertMember } from "../lib/access";
import { caCertificateQueue } from "../lib/queue";

// CA certificates a server's Docker daemon should trust for a self-hosted registry with a
// self-signed (or private-CA) TLS certificate. Installing/removing the file on the server is an SSH
// mutation, so — like every other one in the app — it goes through the worker's queue, not a direct
// SSH call from here; the row's `status` is what the browser polls while that runs.

function toDto(c: CaCertificate): CaCertificateDto {
  return { id: c.id, serverId: c.serverId, name: c.name, host: c.host, status: c.status, error: c.error, createdAt: c.createdAt.toISOString() };
}

export const caCertificateRoutes = new Elysia({ prefix: "/teams/:teamId/servers/:serverId/ca-certificates" })
  .derive(async ({ cookie, params }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) return { cctx: { error: "unauthorized" as const, status: 401 } };
    if (!(await assertMember(params.teamId, user.id))) return { cctx: { error: "forbidden" as const, status: 403 } };
    const [server] = await db.select().from(servers).where(and(eq(servers.id, params.serverId), eq(servers.teamId, params.teamId))).limit(1);
    if (!server) return { cctx: { error: "server not found" as const, status: 404 } };
    return { cctx: { server } };
  })
  .get("/", async ({ cctx, params, set }) => {
    if ("error" in cctx) {
      set.status = cctx.status;
      return { error: cctx.error };
    }
    const rows = await db.select().from(caCertificates).where(eq(caCertificates.serverId, params.serverId));
    return { certificates: rows.map(toDto) };
  })
  .post(
    "/",
    async ({ cctx, params, body, set }) => {
      if ("error" in cctx) {
        set.status = cctx.status;
        return { error: cctx.error };
      }
      if (!body.pem.includes("BEGIN CERTIFICATE")) {
        set.status = 400;
        return { error: "isso não parece um certificado PEM (esperado um bloco -----BEGIN CERTIFICATE-----)" };
      }
      const host = body.host.trim().toLowerCase();
      const [existing] = await db.select({ id: caCertificates.id }).from(caCertificates).where(and(eq(caCertificates.serverId, params.serverId), eq(caCertificates.host, host))).limit(1);
      if (existing) {
        set.status = 409;
        return { error: "já existe um certificado pra esse host neste servidor" };
      }
      const [cert] = await db.insert(caCertificates).values({ serverId: params.serverId, name: body.name, host, pem: body.pem }).returning();
      if (!cert) {
        set.status = 500;
        return { error: "failed to create ca certificate" };
      }
      await caCertificateQueue.add("install", { serverId: params.serverId, host, action: "install", pem: body.pem });
      return { certificate: toDto(cert) };
    },
    { body: t.Object({ name: t.String({ minLength: 1, maxLength: 255 }), host: t.String({ minLength: 1, maxLength: 255 }), pem: t.String({ minLength: 1, maxLength: 20000 }) }) },
  )
  .delete("/:certId", async ({ cctx, params, set }) => {
    if ("error" in cctx) {
      set.status = cctx.status;
      return { error: cctx.error };
    }
    const [cert] = await db.select().from(caCertificates).where(and(eq(caCertificates.id, params.certId), eq(caCertificates.serverId, params.serverId))).limit(1);
    if (!cert) {
      set.status = 404;
      return { error: "ca certificate not found" };
    }
    await db.update(caCertificates).set({ status: "queued", error: null }).where(eq(caCertificates.id, cert.id));
    await caCertificateQueue.add("remove", { serverId: params.serverId, host: cert.host, action: "remove" });
    return { queued: true };
  });
