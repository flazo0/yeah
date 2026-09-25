import { PROXY_NETWORK_NAME } from "./constants";
import { computeRouting, isValidHostname, normalizeHost, traefikLabels } from "./traefik";

// Services as Docker Compose stacks: a template or a pasted docker-compose.yml runs as one project of
// several containers. This module parses/validates the compose text and builds the small override file
// that attaches the stack to the environment's network and to the proxy.

export interface StackDomain {
  /** Compose service that answers on the domain. */
  service: string;
  domain: string;
  /** Port the service listens on inside its container. */
  port: number;
}

export const MAX_COMPOSE_BYTES = 200_000;
const SERVICE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

type Parsed = { ok: true; services: Record<string, Record<string, unknown>> } | { ok: false; error: string };

/** Parses YAML with Bun's built-in parser (API and worker both run on Bun). */
function parseYaml(content: string): unknown {
  const yaml = (globalThis as { Bun?: { YAML?: { parse(text: string): unknown } } }).Bun?.YAML;
  if (!yaml) throw new Error("o parser de YAML só existe no servidor (Bun)");
  return yaml.parse(content);
}

/** Validates a compose file and returns its services; the error is a message for the user. */
export function parseComposeStack(content: string): Parsed {
  if (content.length === 0) return { ok: false, error: "o compose está vazio" };
  if (content.length > MAX_COMPOSE_BYTES) return { ok: false, error: "o compose é grande demais (máximo 200 KB)" };
  let doc: unknown;
  try {
    doc = parseYaml(content);
  } catch (err) {
    return { ok: false, error: `YAML inválido: ${err instanceof Error ? err.message : "erro de sintaxe"}` };
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return { ok: false, error: "o compose precisa ser um objeto YAML com a chave \"services\"" };
  const services = (doc as { services?: unknown }).services;
  if (!services || typeof services !== "object" || Array.isArray(services) || Object.keys(services).length === 0) {
    return { ok: false, error: "o compose precisa ter pelo menos um serviço em \"services\"" };
  }
  for (const [name, def] of Object.entries(services as Record<string, unknown>)) {
    if (!SERVICE_NAME.test(name)) return { ok: false, error: `nome de serviço inválido: ${name}` };
    if (!def || typeof def !== "object" || Array.isArray(def)) return { ok: false, error: `o serviço ${name} precisa ser um objeto` };
    const d = def as Record<string, unknown>;
    if (d.build !== undefined) return { ok: false, error: `o serviço ${name} usa "build": aqui só vale "image" (não há código-fonte pra construir)` };
    if (typeof d.image !== "string" || d.image.trim() === "") return { ok: false, error: `o serviço ${name} precisa de "image"` };
  }
  return { ok: true, services: services as Record<string, Record<string, unknown>> };
}

/** Domains for a stack: valid hostnames, a known service, a real port, and no repeated hostname. */
export function validateStackDomains(domains: StackDomain[], serviceNames: string[]): string | null {
  if (domains.length > 20) return "no máximo 20 domínios por serviço";
  const seen = new Set<string>();
  for (const d of domains) {
    if (!serviceNames.includes(d.service)) return `o serviço "${d.service}" não existe no compose`;
    const host = normalizeHost(d.domain);
    if (!isValidHostname(host)) return `domínio inválido: ${d.domain}`;
    if (!Number.isInteger(d.port) || d.port < 1 || d.port > 65535) return `porta inválida pro domínio ${host}`;
    if (seen.has(host)) return `o domínio ${host} aparece mais de uma vez`;
    seen.add(host);
  }
  return null;
}

export interface StackOverrideOptions {
  /** The compose project name, used for router names. */
  project: string;
  domains: StackDomain[];
}

const q = (s: string) => JSON.stringify(s.split("$").join("$$")); // compose interpolates $, so labels escape it

/**
 * Override file for the proxy only: services with a domain join the proxy network and carry Traefik labels.
 * The environment network is NOT attached here: Compose adds the bare service name as an alias on every
 * network a service joins, so two stacks with a `db` service would answer each other's queries. The stack
 * joins it after `up` instead (stackNetworkJoinCommand). Services that set `network_mode` are left alone.
 */
export function composeStackOverride(services: Record<string, Record<string, unknown>>, o: StackOverrideOptions): string {
  const routed = Object.entries(services).filter(([name, def]) => def.network_mode === undefined && o.domains.some((d) => d.service === name));
  if (routed.length === 0) return "services: {}\n";
  const lines: string[] = ["services:"];
  for (const [name] of routed) {
    lines.push(`  ${name}:`, "    networks:", "      default: {}", `      ${q(PROXY_NETWORK_NAME)}: {}`, "    labels:");
    for (const [i, d] of o.domains.entries()) {
      if (d.service !== name) continue;
      const routing = computeRouting(normalizeHost(d.domain), [], "none");
      for (const label of traefikLabels(`${o.project}-${name}-${i}`, routing, d.port)) lines.push(`      - ${q(label)}`);
    }
  }
  lines.push("networks:", `  ${q(PROXY_NETWORK_NAME)}:`, "    external: true", "");
  return lines.join("\n");
}

/**
 * Connects every container of the stack to the environment network under aliases that cannot collide with
 * another stack's: `<slug>-<service>` for each, plus the plain `<slug>` for the main service. Idempotent
 * (an existing connection is dropped first); containers that cannot join (network_mode: host) are skipped.
 */
export function stackNetworkJoinCommand(project: string, envNetwork: string, slug: string, mainService: string | null): string {
  const filter = `label=com.docker.compose.project=${project}`;
  const main = mainService ?? "";
  return (
    `for c in $(docker ps -q --filter '${filter}'); do ` +
    `s=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.service"}}' "$c"); ` +
    `extra=""; [ "$s" = '${main}' ] && extra="--alias ${slug}"; ` +
    `docker network disconnect -f '${envNetwork}' "$c" >/dev/null 2>&1; ` +
    `docker network connect --alias "${slug}-$s" $extra '${envNetwork}' "$c" || true; ` +
    `done`
  );
}

export interface StackVolume {
  /** Key under the top-level `volumes:` of the compose file. */
  key: string;
  /** The name Docker gives it on the server. */
  dockerName: string;
}

/**
 * The named volumes a stack declares (top-level `volumes:`), with the name Docker uses for each:
 * `<project>_<key>` unless the file sets `name:`. Empty on an invalid compose.
 */
export function composeNamedVolumes(content: string, project: string): StackVolume[] {
  let doc: unknown;
  try {
    doc = parseYaml(content);
  } catch {
    return [];
  }
  const volumes = doc && typeof doc === "object" ? (doc as { volumes?: unknown }).volumes : undefined;
  if (!volumes || typeof volumes !== "object" || Array.isArray(volumes)) return [];
  const out: StackVolume[] = [];
  for (const [key, def] of Object.entries(volumes as Record<string, unknown>)) {
    if (!SERVICE_NAME.test(key)) continue;
    const d = def && typeof def === "object" ? (def as { name?: unknown; external?: unknown }) : {};
    const explicit = typeof d.name === "string" && d.name.trim() !== "" ? d.name.trim() : null;
    out.push({ key, dockerName: explicit ?? (d.external ? key : `${project}_${key}`) });
  }
  return out;
}
