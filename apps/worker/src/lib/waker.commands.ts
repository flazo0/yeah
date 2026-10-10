import { LOG_ROTATION_FLAGS, PROXY_DIR, PROXY_NETWORK_NAME, WAKER_CONTAINER_NAME, WAKER_PORT, shellQuote } from "@yeah/shared";

export const WAKER_DIR = `${PROXY_DIR}/waker`;
export const WAKE_CONFIG_DIR = `${PROXY_DIR}/wake`;
export const WAKER_SCRIPT_PATH = `${WAKER_DIR}/waker.cjs`;
export const WAKER_IMAGE = "node:22-alpine";

/** Where the waker finds the app's entry (one JSON file per container). */
export function wakeConfigPath(containerName: string): string {
  return `${WAKE_CONFIG_DIR}/${containerName}.json`;
}

/** The URL Traefik forwards a sleep-enabled app's domain to. */
export function wakerBackendUrl(): string {
  return `http://${WAKER_CONTAINER_NAME}:${WAKER_PORT}`;
}

export function wakeConfigJson(containerName: string, hosts: string[], port: number, sleepAfterMinutes: number): string {
  return `${JSON.stringify({ container: containerName, hosts, port, idleSeconds: sleepAfterMinutes * 60 }, null, 2)}\n`;
}

/** Creates the directories the waker needs; run before writing its script or any wake config. */
export function prepareWakerDirsCommand(): string {
  return `mkdir -p ${shellQuote(WAKER_DIR)} ${shellQuote(WAKE_CONFIG_DIR)}`;
}

/**
 * Installs the waker script (already uploaded to `${WAKER_SCRIPT_PATH}.new`) and makes sure the waker runs:
 * created on first use, restarted only when its script actually changed (a restart drops open connections).
 * The directory — not the file — is bind-mounted, so replacing the script never leaves a stale inode behind.
 */
export function ensureWakerCommand(): string {
  const script = shellQuote(WAKER_SCRIPT_PATH);
  const next = shellQuote(`${WAKER_SCRIPT_PATH}.new`);
  const name = shellQuote(WAKER_CONTAINER_NAME);
  return (
    `changed=0; if ! cmp -s ${next} ${script} 2>/dev/null; then mv ${next} ${script}; changed=1; else rm -f ${next}; fi; ` +
    `if docker inspect ${name} >/dev/null 2>&1; then ` +
    `if [ "$changed" = 1 ]; then docker restart ${name} >/dev/null; else docker start ${name} >/dev/null 2>&1 || true; fi; ` +
    `else docker run -d --name ${name} --restart unless-stopped --network ${shellQuote(PROXY_NETWORK_NAME)} --label traefik.enable=false ` +
    `--memory 96m ${LOG_ROTATION_FLAGS}` +
    `-v /var/run/docker.sock:/var/run/docker.sock -v ${shellQuote(`${WAKER_DIR}:/app:ro`)} -v ${shellQuote(`${WAKE_CONFIG_DIR}:/wake:ro`)} ` +
    `-e WAKER_PORT=${WAKER_PORT} ${shellQuote(WAKER_IMAGE)} node /app/waker.cjs >/dev/null; fi`
  );
}

export function removeWakeConfigCommand(containerName: string): string {
  return `rm -f ${shellQuote(wakeConfigPath(containerName))}`;
}
