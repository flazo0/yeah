import { readFileSync } from "node:fs";
import { execStream, writeRemoteFile, type Client } from "@yeah/ssh";
import { PROXY_DIR, computeRouting, shellQuote, traefikDynamicConfig } from "@yeah/shared";
import type { Application } from "@yeah/db";
import { ensureWakerCommand, prepareWakerDirsCommand, removeWakeConfigCommand, WAKER_SCRIPT_PATH, wakeConfigJson, wakeConfigPath, wakerBackendUrl } from "./waker.commands";

const WAKER_SCRIPT = readFileSync(new URL("./waker.cjs", import.meta.url), "utf8");

async function run(conn: Client, command: string): Promise<void> {
  const { exitCode } = await execStream(conn, command, () => undefined);
  if (exitCode !== 0) throw new Error(`comando falhou (${exitCode}): ${command.slice(0, 120)}`);
}

/**
 * Writes (or removes) the Traefik File Provider routing for a plain app, and sets up scale-to-zero when
 * `sleepAfterMinutes` is set: the domain then points at the server's waker, which holds the request,
 * starts the container and forwards (see lib/waker.cjs). Turning sleep off sends the domain straight to the
 * container again and starts it if it was asleep.
 */
export async function writeAppRouting(conn: Client, application: Application, containerName: string, domain: string | null): Promise<void> {
  const dynamicPath = `${PROXY_DIR}/dynamic/${containerName}.yml`;
  if (!domain) {
    await execStream(conn, `rm -f ${shellQuote(dynamicPath)} ${shellQuote(wakeConfigPath(containerName))}; docker start ${shellQuote(containerName)} >/dev/null 2>&1 || true`, () => undefined);
    return;
  }
  const routing = computeRouting(domain, application.extraDomains, application.wwwRedirect);
  const basicAuth = application.basicAuthUser && application.basicAuthHash ? { user: application.basicAuthUser, hash: application.basicAuthHash } : undefined;
  // The waker sits in front for scale-to-zero and for maintenance mode (it serves the 503 page).
  if (application.sleepAfterMinutes || application.maintenanceMode) {
    await run(conn, prepareWakerDirsCommand());
    await writeRemoteFile(conn, `${WAKER_SCRIPT_PATH}.new`, WAKER_SCRIPT);
    await run(conn, ensureWakerCommand());
    const maintenance = application.maintenanceMode ? (application.maintenanceMessage ?? "") : undefined;
    await writeRemoteFile(conn, wakeConfigPath(containerName), wakeConfigJson(containerName, routing.hosts, application.port, application.sleepAfterMinutes, maintenance));
    await writeRemoteFile(conn, dynamicPath, traefikDynamicConfig(containerName, routing, application.port, { backendUrl: wakerBackendUrl(), basicAuth }));
    return;
  }
  await writeRemoteFile(conn, dynamicPath, traefikDynamicConfig(containerName, routing, application.port, { basicAuth }));
  await execStream(conn, `${removeWakeConfigCommand(containerName)}; docker start ${shellQuote(containerName)} >/dev/null 2>&1 || true`, () => undefined);
}
