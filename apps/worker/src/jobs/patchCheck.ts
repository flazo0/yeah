import { eq } from "drizzle-orm";
import { servers, type Server } from "@yeah/db";
import { connectSsh, execStream, shellQuote } from "@yeah/ssh";
import { parsePatchCheck, patchCheckCommand, type PatchStatus } from "@yeah/shared";
import { db } from "../lib/db";
import { notifyTeam } from "../lib/notify";
import { log } from "../lib/logger";

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

/** Every connected server, one after the other (apt-get update is the heavy part, and this runs a few times a day at most). */
export async function runPatchChecks(): Promise<void> {
  const rows = await db.select().from(servers).where(eq(servers.status, "connected"));
  for (const server of rows) {
    try {
      await checkServerPatches(server);
    } catch (err) {
      log.warn("patch check failed", { server: server.name, err });
    }
  }
}
