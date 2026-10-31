import { isValidHostname, normalizeHost } from "./traefik";

// A domain with automatic HTTPS for the panel itself. The server that hosts the panel already runs a Traefik
// (the proxy for the applications); the panel's web container joins the proxy network under a fixed alias and a
// file-provider route sends the domain to it, with a Let's Encrypt certificate.

/** Alias of the panel's web container on the proxy network (set in docker-compose.prod.yml). */
export const PANEL_BACKEND_HOST = "yeah-panel-web";
export const PANEL_BACKEND_URL = `http://${PANEL_BACKEND_HOST}:80`;
/** File written into the proxy's dynamic directory. */
export const PANEL_ROUTE_FILE = "yeah-panel.yml";

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** A clean hostname for the panel, or an error message for the user. Accepts what people paste ("https://Panel.Example.com/"). */
export function normalizePanelDomain(input: string): { ok: true; domain: string } | { ok: false; error: string } {
  const host = normalizeHost(input);
  if (host === "") return { ok: false, error: "enter a domain name" };
  if (host.includes(":")) return { ok: false, error: "enter the domain only, without a port" };
  if (host.includes("*")) return { ok: false, error: "a wildcard cannot be the panel's domain" };
  if (IPV4.test(host)) return { ok: false, error: "an IP address cannot get a certificate: use a domain name" };
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return { ok: false, error: "this name is not public, so no certificate can be issued for it" };
  if (!host.includes(".")) return { ok: false, error: "enter a full domain name such as panel.example.com" };
  if (!isValidHostname(host)) return { ok: false, error: "this is not a valid domain name" };
  return { ok: true, domain: host };
}

/** Traefik dynamic configuration that serves `domain` from the panel's web container over HTTPS. */
export function panelRouteConfig(domain: string): string {
  return [
    "http:",
    "  routers:",
    "    yeah-panel:",
    `      rule: "Host(\`${domain}\`)"`,
    "      entryPoints:",
    "        - websecure",
    "      tls:",
    "        certResolver: letsencrypt",
    "      service: yeah-panel",
    "      priority: 10000",
    "  services:",
    "    yeah-panel:",
    "      loadBalancer:",
    "        servers:",
    `          - url: "${PANEL_BACKEND_URL}"`,
    "",
  ].join("\n");
}

/**
 * The origins the panel accepts: the ones in WEB_ORIGIN plus the panel's own domain over HTTPS. An empty
 * WEB_ORIGIN means "accept any" (the development default), and adding the domain there would silently turn
 * that into "accept only the domain", so an empty list stays empty.
 */
export function withPanelOrigin(webOrigin: string | undefined, panelDomain: string | null): string {
  const list = (webOrigin ?? "").split(",").map((o) => o.trim()).filter(Boolean);
  if (list.length === 0 || !panelDomain) return list.join(",");
  const own = `https://${panelDomain}`;
  return list.some((o) => o.replace(/\/+$/, "").toLowerCase() === own) ? list.join(",") : [...list, own].join(",");
}

/** Where the panel is installed on its host; the compose project's working directory identifies its containers. */
export const PANEL_INSTALL_DIR = "/opt/yeah";

const PANEL_WEB = `$(docker ps -q --filter label=com.docker.compose.service=web --filter 'label=com.docker.compose.project.working_dir=${PANEL_INSTALL_DIR}' | head -n 1)`;

/**
 * Puts the panel's web container on the proxy network under the fixed alias, so the route can reach it. Done by
 * command instead of in docker-compose.prod.yml on purpose: an external network in the compose file would make
 * `compose up` fail on every host where the proxy was never set up, and the first update from an older version
 * runs the old update script, which would not create it. Without a domain the container stays off that network.
 * With \`onlyWithRoute\` it does nothing unless the route file exists (used after every update, which recreates the container).
 */
export function panelAttachCommand(proxyNetwork: string, proxyDir: string, onlyWithRoute = false): string {
  const guard = onlyWithRoute ? `[ -f '${proxyDir}/dynamic/${PANEL_ROUTE_FILE}' ] && ` : "";
  return (
    `c=${PANEL_WEB}; ${guard}[ -n "$c" ] && docker network inspect '${proxyNetwork}' >/dev/null 2>&1 && ` +
    `{ docker network disconnect '${proxyNetwork}' "$c" >/dev/null 2>&1; docker network connect --alias ${PANEL_BACKEND_HOST} '${proxyNetwork}' "$c"; }`
  );
}

/** The opposite: takes the web container off the proxy network (the domain was removed). Always succeeds. */
export function panelDetachCommand(proxyNetwork: string): string {
  return `c=${PANEL_WEB}; if [ -n "$c" ]; then docker network disconnect '${proxyNetwork}' "$c" >/dev/null 2>&1; fi; true`;
}
