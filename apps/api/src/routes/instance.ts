import { Elysia, t } from "elysia";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { and, eq } from "drizzle-orm";
import { servers, setPanelDomain } from "@yeah/db";
import { normalizePanelDomain } from "@yeah/shared";
import { db } from "../lib/db";
import { getUserFromSessionId, SESSION_COOKIE } from "../lib/session";
import { assertMember } from "../lib/access";
import { proxyProvisionQueue } from "../lib/queue";
import { currentPanelDomain, refreshPanelDomain } from "../lib/origins";

// Settings of the whole installation, reached through a team like every other route so that changes are audited.
// Today that is the panel's own domain: HTTPS through the Traefik of the server that hosts the panel.

interface PlatformServer {
  id: string;
  name: string;
  host: string;
  proxyActive: boolean;
  hasAcmeEmail: boolean;
}

async function platformServer(teamId: string): Promise<PlatformServer | null> {
  const [row] = await db.select().from(servers).where(and(eq(servers.teamId, teamId), eq(servers.isPlatformHost, true))).limit(1);
  if (!row) return null;
  return { id: row.id, name: row.name, host: row.host, proxyActive: row.proxyStatus === "active", hasAcmeEmail: !!row.acmeEmail };
}

/**
 * Every address `host` resolves to (a literal IP resolves to itself); empty when it does not resolve. Uses the
 * system resolver (`lookup`), not c-ares (`resolve4`): in Bun the latter fails with ECONNREFUSED whenever it
 * cannot find the DNS servers itself, which is the case on some hosts and in some containers.
 */
export async function addressesOf(host: string): Promise<string[]> {
  if (isIP(host)) return [host];
  try {
    return [...new Set((await lookup(host, { all: true })).map((a) => a.address))];
  } catch {
    return [];
  }
}

export const instanceRoutes = new Elysia({ prefix: "/teams/:teamId/instance" })
  .get("/panel-domain", async ({ cookie, params, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    if (!(await assertMember(params.teamId, user.id))) {
      set.status = 403;
      return { error: "forbidden" };
    }
    await refreshPanelDomain();
    return { domain: currentPanelDomain(), platformServer: await platformServer(params.teamId) };
  })
  .post(
    "/panel-domain/check",
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
      const parsed = normalizePanelDomain(body.domain);
      if (!parsed.ok) {
        set.status = 400;
        return { error: parsed.error };
      }
      const server = await platformServer(params.teamId);
      if (!server) {
        set.status = 400;
        return { error: "this installation has no server that hosts the panel" };
      }
      const [found, expected] = await Promise.all([addressesOf(parsed.domain), addressesOf(server.host)]);
      return { domain: parsed.domain, found, expected, matches: found.length > 0 && found.some((a) => expected.includes(a)) };
    },
    { body: t.Object({ domain: t.String({ maxLength: 255 }) }) },
  )
  .put(
    "/panel-domain",
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
      const server = await platformServer(params.teamId);
      const raw = body.domain?.trim() ?? "";
      if (raw === "") {
        await setPanelDomain(db, null);
        await refreshPanelDomain();
        if (server) await proxyProvisionQueue.add("panel-route", { serverId: server.id, action: "panel-route" });
        return { domain: null, platformServer: server };
      }
      const parsed = normalizePanelDomain(raw);
      if (!parsed.ok) {
        set.status = 400;
        return { error: parsed.error };
      }
      if (!server) {
        set.status = 400;
        return { error: "this installation has no server that hosts the panel, so there is no proxy to serve the domain. Install the panel on a server managed by yeah, or put a reverse proxy in front (see the installation guide)." };
      }
      if (!server.proxyActive) {
        set.status = 400;
        return { error: `the proxy is not active on ${server.name}: activate it first (Servers → ${server.name} → Proxy) so it can serve the domain with a certificate` };
      }
      if (!server.hasAcmeEmail) {
        set.status = 400;
        return { error: `set the Let's Encrypt e-mail on ${server.name} first (Servers → ${server.name} → Proxy)` };
      }
      await setPanelDomain(db, parsed.domain);
      await refreshPanelDomain();
      await proxyProvisionQueue.add("panel-route", { serverId: server.id, action: "panel-route" });
      return { domain: parsed.domain, platformServer: server };
    },
    { body: t.Object({ domain: t.Nullable(t.String({ maxLength: 255 })) }) },
  );
