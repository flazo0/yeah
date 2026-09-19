/** The Docker network every proxied (domain-routed) container and the per-server Traefik proxy
 * itself join — shared between apps/worker/src/jobs/provisionProxy.ts (creates it, joins Traefik)
 * and deployApplication.ts/provisionService.ts (join it when a container needs a domain). */
export const PROXY_NETWORK_NAME = "yeah-proxy-net";
