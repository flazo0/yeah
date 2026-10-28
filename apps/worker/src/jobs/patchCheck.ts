import { eq } from "drizzle-orm";
import { servers, type Server } from "@yeah/db";
import { connectSsh, execStream, shellQuote } from "@yeah/ssh";
import { formatSemVer, isBehind, latestPatch, parsePatchCheck, parseSemVer, patchCheckCommand, PROXY_CONTAINER_NAME, traefikVersionCommand, type PatchStatus } from "@yeah/shared";
import { db } from "../lib/db";
import { notifyTeam } from "../lib/notify";
import { log } from "../lib/logger";
import { Throttle } from "../lib/throttle";

// One reminder a day per server, however often the check runs.
const proxyAlert = new Throttle(24 * 60 * 60 * 1000);

/** apt needs root: non-root users go through passwordless sudo. */
function asRoot(server: Server, command: string): string {
  return server.sshUser === "root" ? command : `sudo -n sh -c ${shellQuote(command)}`;
}

/** Whether to announce: only when the number of pending security updates grew past what was already announced. */
export function shouldNotifySecurity(status: PatchStatus, alreadyNotified: number): boolean {
  return status.security > 0 && status.security > alreadyNotified;
}

/** Checks one server for pending OS updates, stores the snapshot, and notifies about new security updates. */
export async function checkServerPatches(server: Server): Promise<void> {
  const conn = await connectSsh({ host: server.host, port: server.port, username: server.sshUser, privateKey: server.privateKey, timeoutMs: server.sshTimeoutSeconds * 1000 });
  let output = "";
  try {
    await execStream(conn, asRoot(server, patchCheckCommand()), (chunk) => {
      output += chunk;
    });
  } finally {
    conn.end();
  }
  const status = parsePatchCheck(output);
  await db
    .update(servers)
    .set({
      patchCheckedAt: new Date(),
      patchUpdates: status.updates,
      patchSecurity: status.security,
      patchRebootRequired: status.rebootRequired,
      patchPackages: status.packages,
      patchNotifiedSecurity: status.security === 0 ? 0 : Math.max(server.patchNotifiedSecurity, status.security),
    })
    .where(eq(servers.id, server.id));
  if (shouldNotifySecurity(status, server.patchNotifiedSecurity)) {
    const risky = status.packages.filter((p) => p.security && p.risky).map((p) => p.name);
    await notifyTeam(
      server.teamId,
      "server.patches",
      `Atualizações de segurança pendentes em ${server.name}`,
      `${status.security} atualização(ões) de segurança de ${status.updates} pendentes${status.rebootRequired ? "; o servidor pede reinício" : ""}.${risky.length ? ` Atenção (podem reiniciar serviços): ${risky.slice(0, 5).join(", ")}.` : ""}`,
      "warning",
    );
  }
}

// Newest Traefik patch of the line we provision, looked up on GitHub at most once an hour (unauthenticated API: 60 requests/hour).
let latestTraefik: { at: number; version: ReturnType<typeof latestPatch> } | null = null;

async function newestTraefikPatch(): Promise<ReturnType<typeof latestPatch>> {
  if (latestTraefik && Date.now() - latestTraefik.at < 60 * 60 * 1000) return latestTraefik.version;
  const res = await fetch("https://api.github.com/repos/traefik/traefik/releases?per_page=100", { headers: { accept: "application/vnd.github+json", "user-agent": "yeah" } });
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  const releases = (await res.json()) as Array<{ tag_name?: string }>;
  const version = latestPatch(releases.map((r) => r.tag_name ?? ""), { major: 2, minor: 11 });
  latestTraefik = { at: Date.now(), version };
  return version;
}

/** Tells the team when the server's proxy is behind the newest patch (re-provisioning the proxy pulls it). */
export async function checkProxyVersion(server: Server): Promise<void> {
  if (server.proxyStatus !== "active") return;
  const conn = await connectSsh({ host: server.host, port: server.port, username: server.sshUser, privateKey: server.privateKey, timeoutMs: server.sshTimeoutSeconds * 1000 });
  let output = "";
  try {
    await execStream(conn, traefikVersionCommand(PROXY_CONTAINER_NAME), (chunk) => {
      output += chunk;
    });
  } finally {
    conn.end();
  }
  const current = parseSemVer(output);
  const latest = await newestTraefikPatch();
  if (!current || !latest || !isBehind(current, latest)) return;
  if (!proxyAlert.allow(server.id)) return;
  await notifyTeam(server.teamId, "traefik.outdated", `Proxy desatualizado em ${server.name}`, `Traefik ${formatSemVer(current)} → ${formatSemVer(latest)}. Reprovisione o proxy (Servidor → Proxy) para baixar a versão nova.`, "warning");
}

/** Every connected server, one after the other (apt-get update is the heavy part, and this runs a few times a day at most). */
export async function runPatchChecks(): Promise<void> {
  const rows = await db.select().from(servers).where(eq(servers.status, "connected"));
  for (const server of rows) {
    try {
      await checkServerPatches(server);
    } catch (err) {
      log.warn("patch check failed", { server: server.name, err });
    }
    try {
      await checkProxyVersion(server);
    } catch (err) {
      log.warn("proxy version check failed", { server: server.name, err });
    }
  }
}
