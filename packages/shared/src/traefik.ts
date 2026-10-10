import { PROXY_NETWORK_NAME } from "./constants";

// Routing labels for the Traefik proxy: several hostnames per application and an optional
// www <-> root redirect. Pure, so the plain `docker run` path and the compose override share them.

export type WwwRedirect = "none" | "www_to_root" | "root_to_www";
export const WWW_REDIRECTS: WwwRedirect[] = ["none", "www_to_root", "root_to_www"];

const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** Lowercases, drops a pasted scheme, path and trailing dot. Returns "" for empty input. */
export function normalizeHost(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/\.$/, "");
}

export function isValidHostname(host: string): boolean {
  return HOSTNAME.test(host);
}

export interface Routing {
  /** Every hostname the app answers on (canonical first). */
  hosts: string[];
  /** Where a redirect sends visitors; equals hosts[0]. */
  canonical: string;
  /** The hostname that only redirects to canonical, when a www redirect is configured. */
  redirectFrom: string | null;
}

/**
 * `primary` is the app's main domain; `extras` are additional hostnames served as-is. With a www
 * redirect the canonical host is fixed by the mode (root or www.<root>) and the other one redirects to it.
 */
export function computeRouting(primary: string, extras: string[], redirect: WwwRedirect): Routing {
  const base = primary.replace(/^www\./, "");
  let canonical = primary;
  let redirectFrom: string | null = null;
  if (redirect === "www_to_root") {
    canonical = base;
    redirectFrom = `www.${base}`;
  } else if (redirect === "root_to_www") {
    canonical = `www.${base}`;
    redirectFrom = base;
  }
  const hosts = [...new Set([canonical, ...extras.filter((e) => e !== redirectFrom)])];
  return { hosts, canonical, redirectFrom };
}

const regexEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `key=value` Traefik labels for a container `name` (router/service names) listening on `port`. */
export function traefikLabels(name: string, routing: Routing, port: number): string[] {
  const rule = routing.hosts.map((h) => `Host(\`${h}\`)`).join(" || ");
  const labels = [
    "traefik.enable=true",
    `traefik.docker.network=${PROXY_NETWORK_NAME}`,
    `traefik.http.routers.${name}.rule=${rule}`,
    `traefik.http.routers.${name}.entrypoints=websecure`,
    `traefik.http.routers.${name}.tls.certresolver=letsencrypt`,
    `traefik.http.services.${name}.loadbalancer.server.port=${port}`,
  ];
  if (routing.redirectFrom) {
    const r = `${name}-redir`;
    labels.push(
      `traefik.http.routers.${r}.rule=Host(\`${routing.redirectFrom}\`)`,
      `traefik.http.routers.${r}.entrypoints=websecure`,
      `traefik.http.routers.${r}.tls.certresolver=letsencrypt`,
      `traefik.http.routers.${r}.service=${name}`,
      `traefik.http.routers.${r}.middlewares=${r}`,
      `traefik.http.middlewares.${r}.redirectregex.regex=^https?://${regexEscape(routing.redirectFrom)}/(.*)`,
      `traefik.http.middlewares.${r}.redirectregex.replacement=https://${routing.canonical}/\${1}`,
      `traefik.http.middlewares.${r}.redirectregex.permanent=true`,
    );
  }
  return labels;
}

/**
 * Traefik File Provider YAML equivalent of `traefikLabels()` — same routing, same backend (the
 * container's own network alias on PROXY_NETWORK_NAME and its port, identical to what the Docker
 * provider would resolve the label-based router to), but written to a file Traefik watches instead of
 * baked into the container at creation time. `priority` is set high enough to beat the Docker
 * provider's own (rule-length-based, normally well under 100) default, so a file-provider router for
 * the same name always wins when both exist — letting a domain-only change update this file alone,
 * with no container recreate and so no redeploy. See docs/ROADMAP.md Fase 6 for why both can coexist.
 */
export function traefikDynamicConfig(name: string, routing: Routing, port: number): string {
  const rule = routing.hosts.map((h) => `Host(\`${h}\`)`).join(" || ");
  const lines = [
    "http:",
    "  routers:",
    `    ${name}:`,
    `      rule: "${rule}"`,
    "      entryPoints:",
    "        - websecure",
    "      tls:",
    "        certResolver: letsencrypt",
    `      service: ${name}`,
    "      priority: 1000",
  ];
  if (routing.redirectFrom) {
    const r = `${name}-redir`;
    lines.push(
      `    ${r}:`,
      `      rule: "Host(\`${routing.redirectFrom}\`)"`,
      "      entryPoints:",
      "        - websecure",
      "      tls:",
      "        certResolver: letsencrypt",
      `      service: ${name}`,
      "      middlewares:",
      `        - ${r}`,
      "      priority: 1000",
    );
  }
  lines.push("  services:", `    ${name}:`, "      loadBalancer:", "        servers:", `          - url: "http://${name}:${port}"`);
  if (routing.redirectFrom) {
    const r = `${name}-redir`;
    lines.push(
      "  middlewares:",
      `    ${r}:`,
      "      redirectRegex:",
      `        regex: "^https?://${regexEscape(routing.redirectFrom)}/(.*)"`,
      `        replacement: "https://${routing.canonical}/\${1}"`,
      "        permanent: true",
    );
  }
  return `${lines.join("\n")}\n`;
}
