import { and, eq } from "drizzle-orm";
import { caCertificates, servers } from "@yeah/db";
import { connectSsh, execStream, writeRemoteFile } from "@yeah/ssh";
import type { CaCertificateJobData } from "@yeah/queue";
import type { Job } from "bullmq";
import { db } from "../lib/db";
import { buildInstallCaCertCommand, buildRemoveCaCertCommand, caCertDir } from "./caCertificate.commands";

export { buildInstallCaCertCommand, buildRemoveCaCertCommand, caCertDir } from "./caCertificate.commands";

/** Installs or removes a registry's CA certificate under /etc/docker/certs.d on one server. */
export function makeCaCertificateProcessor() {
  return async function caCertificate(job: Job<CaCertificateJobData>) {
    const { serverId, host, action, pem } = job.data;
    const [server] = await db.select().from(servers).where(eq(servers.id, serverId)).limit(1);
    if (!server) return;

    try {
      const conn = await connectSsh({ host: server.host, port: server.port, username: server.sshUser, privateKey: server.privateKey, timeoutMs: server.sshTimeoutSeconds * 1000 });
      try {
        if (action === "install") {
          if (!pem) throw new Error("certificado vazio");
          const result = await execStream(conn, buildInstallCaCertCommand(host), () => undefined);
          if (result.exitCode !== 0) throw new Error(`não foi possível criar ${caCertDir(host)} (código ${result.exitCode})`);
          await writeRemoteFile(conn, `${caCertDir(host)}/ca.crt`, pem.endsWith("\n") ? pem : `${pem}\n`);
          await db.update(caCertificates).set({ status: "success", error: null }).where(and(eq(caCertificates.serverId, serverId), eq(caCertificates.host, host)));
        } else {
          const result = await execStream(conn, buildRemoveCaCertCommand(host), () => undefined);
          if (result.exitCode !== 0) throw new Error(`não foi possível remover ${caCertDir(host)} (código ${result.exitCode})`);
          await db.delete(caCertificates).where(and(eq(caCertificates.serverId, serverId), eq(caCertificates.host, host)));
        }
      } finally {
        conn.end();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[worker] ca-certificate: ${action} failed for server ${serverId} (${host}):`, message);
      await db.update(caCertificates).set({ status: "failed", error: message }).where(and(eq(caCertificates.serverId, serverId), eq(caCertificates.host, host)));
    }
  };
}
