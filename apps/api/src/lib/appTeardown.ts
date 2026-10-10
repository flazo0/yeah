import { applications, type Application, type ApplicationVolume, type Server } from "@yeah/db";
import { composeProjectName, composeTeardownCommand, PROXY_DIR, volumeName } from "@yeah/shared";
import { connectSsh, execStream, shellQuote } from "@yeah/ssh";

void applications;

/**
 * Removes an application's container(s), app directory and named volumes from a server. Deliberate
 * exception to "the API never SSHes directly" (see servers.ts): a bounded, synchronous teardown the
 * browser is waiting on. Returns an error message instead of throwing, so callers decide how much a
 * failure matters (deleting an app proceeds anyway; moving it to another server does not).
 */
export async function tearDownApplication(application: Application, server: Server, volumes: ApplicationVolume[]): Promise<string | null> {
  const containerName = `yeah-app-${application.id}`;
  const appDir = `/opt/yeah-apps/${application.id}`;
  const backupsDir = `/opt/yeah-backups/volumes/${application.id}`;
  const volumeRm = volumes.map((v) => `docker volume rm ${shellQuote(volumeName(v.id))} >/dev/null 2>&1 || true`).join(" && ");
  // The Traefik File Provider routing file (Fase 6) outlives the container otherwise — compose apps
  // never get one (see deployApplication.ts), so this is a no-op `rm -f` for them.
  const dynamicRm = `rm -f ${shellQuote(`${PROXY_DIR}/dynamic/${containerName}.yml`)} >/dev/null 2>&1 || true`;
  const command =
    (application.buildPack === "docker_compose" ? composeTeardownCommand(composeProjectName(application.id)) : `docker rm -f ${shellQuote(containerName)} >/dev/null 2>&1 || true`) +
    ` && ${dynamicRm}` +
    ` && rm -rf ${shellQuote(appDir)} ${shellQuote(backupsDir)} >/dev/null 2>&1 || true` +
    (volumeRm ? ` && ${volumeRm}` : "");
  try {
    const conn = await connectSsh({
      host: server.host,
      port: server.port,
      username: server.sshUser,
      privateKey: server.privateKey,
      timeoutMs: server.sshTimeoutSeconds * 1000,
    });
    try {
      await execStream(conn, command, () => {});
    } finally {
      conn.end();
    }
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}
