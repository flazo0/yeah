import { shellQuote, PROXY_NETWORK_NAME } from "@yeah/shared";

// Pure command builders for a per-server Cloudflare Tunnel into the Traefik proxy already running
// there — kept separate so they can be unit tested without loading ssh2 (same split as the other jobs).

export const CLOUDFLARE_TUNNEL_CONTAINER_NAME = "yeah-cf-tunnel";

/**
 * Joins the same Docker network as the proxy (yeah-proxy-net) so `cloudflared` can reach it by
 * container name — the tunnel's public hostname(s) are configured on Cloudflare's side (Zero Trust →
 * Networks → Tunnels) to point at `http://yeah-proxy:80`, same as the panel's own tunnel does for
 * itself. One tunnel covers every resource on this server: a wildcard public hostname behaves the
 * same as a single-resource one, since both just forward to the one Traefik entrypoint that already
 * does Host-header routing for everything deployed here.
 */
export function buildInstallCloudflareTunnelCommand(token: string): string {
  return (
    `docker network create ${shellQuote(PROXY_NETWORK_NAME)} >/dev/null 2>&1 || true && ` +
    `docker rm -f ${shellQuote(CLOUDFLARE_TUNNEL_CONTAINER_NAME)} >/dev/null 2>&1 || true && ` +
    `docker run -d --name ${shellQuote(CLOUDFLARE_TUNNEL_CONTAINER_NAME)} ` +
    `--network ${shellQuote(PROXY_NETWORK_NAME)} ` +
    `--restart unless-stopped cloudflare/cloudflared:latest ` +
    `tunnel --no-autoupdate run --token ${shellQuote(token)}`
  );
}

export function buildRemoveCloudflareTunnelCommand(): string {
  return `docker rm -f ${shellQuote(CLOUDFLARE_TUNNEL_CONTAINER_NAME)} >/dev/null 2>&1 || true`;
}
