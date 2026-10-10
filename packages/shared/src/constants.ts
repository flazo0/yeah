/** The Docker network every proxied (domain-routed) container and the per-server Traefik proxy
 * itself join — shared between apps/worker/src/jobs/provisionProxy.ts (creates it, joins Traefik)
 * and deployApplication.ts/provisionService.ts (join it when a container needs a domain). */
/** Every server gets a daily cleanup at 04:00 UTC unless someone turned it off. */
export const DEFAULT_CLEANUP_CRON = "0 4 * * *";
export const DEFAULT_CLEANUP_TIMEZONE = "UTC";

export const PROXY_NETWORK_NAME = "yeah-proxy-net";

export const PROXY_CONTAINER_NAME = "yeah-proxy";

/** Where the proxy's own config lives on the managed server — traefik.yml, acme.json, and (Fase 6)
 * the dynamic/ directory the File Provider watches for no-redeploy domain changes. */
export const PROXY_DIR = "/opt/yeah-proxy";

/** `docker restart` for the proxy's own container. */
export function buildProxyRestartCommand(): string {
  return `docker restart '${PROXY_CONTAINER_NAME}'`;
}

/** Tail of the proxy container's logs (both streams, most recent last). */
export function buildProxyLogsCommand(tail: number): string {
  return `docker logs --tail ${Math.max(1, Math.floor(tail))} '${PROXY_CONTAINER_NAME}' 2>&1`;
}

/** Whether the proxy container exists and is running right now ("true"/"false"/empty if it doesn't exist). */
export function buildProxyIsRunningCommand(): string {
  return `docker inspect -f '{{.State.Running}}' '${PROXY_CONTAINER_NAME}' 2>/dev/null || true`;
}
