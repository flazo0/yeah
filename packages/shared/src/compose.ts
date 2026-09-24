import { PROXY_NETWORK_NAME } from "./constants";
import { shellQuote } from "./shell";

// Docker Compose applications: one application = one compose project (`yeah-app-<id>`), possibly many
// containers. Everything that used to address "the container" by name addresses the project by the
// labels Compose puts on its containers instead, so these helpers work without the compose file.

export const DEFAULT_COMPOSE_FILE = "docker-compose.yml";

/** A compose file path is a plain relative path inside the repo (same rules as a publish directory, but never "."). */
export function isSafeComposeFile(path: string): boolean {
  if (path === "" || path === ".") return false;
  if (path.startsWith("/") || path.includes("\\") || /["'`$;&|<>\s]/.test(path)) return false;
  return !path.split("/").includes("..");
}

/** A compose service name: what compose itself accepts for a key under `services:`. */
export function isValidComposeService(name: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(name);
}

export function composeProjectName(applicationId: string): string {
  return `yeah-app-${applicationId}`;
}

function projectFilter(project: string, service?: string | null): string {
  const project_ = `--filter ${shellQuote(`label=com.docker.compose.project=${project}`)}`;
  return service ? `${project_} --filter ${shellQuote(`label=com.docker.compose.service=${service}`)}` : project_;
}

/** Shell fragment expanding to the ids of the project's containers (running or not), optionally of one service. */
export function composeContainerIds(project: string, service?: string | null): string {
  return `$(docker ps -aq ${projectFilter(project, service)})`;
}

/** Recent logs of every container of the project, each line prefixed with its container's name. */
export function composeLogsCommand(project: string, tail: number): string {
  return (
    `ids=$(docker ps -aq ${projectFilter(project)}); ` +
    `[ -n "$ids" ] || { echo "nenhum container do projeto compose — faça um deploy primeiro"; exit 1; }; ` +
    `for c in $ids; do n=$(docker inspect -f '{{.Name}}' $c | sed 's#^/##'); ` +
    `docker logs --tail ${Math.floor(tail)} --timestamps $c 2>&1 | sed "s#^#[$n] #"; done`
  );
}

/** start / stop / restart every container of the project; stop and restart honor the grace period. */
export function composeLifecycleCommand(action: "start" | "stop" | "restart", project: string, graceSeconds: number): string {
  const ids = `ids=$(docker ps -aq ${projectFilter(project)}); [ -n "$ids" ] || { echo "nenhum container do projeto compose"; exit 1; }; `;
  const grace = Math.max(0, Math.floor(graceSeconds));
  if (action === "start") return `${ids}docker start $ids`;
  if (action === "stop") return `${ids}docker stop -t ${grace} $ids`;
  return `${ids}docker restart -t ${grace} $ids`;
}

/** Removes the project's containers, network and named volumes. Safe when nothing exists. */
export function composeTeardownCommand(project: string): string {
  const f = projectFilter(project);
  return (
    `docker ps -aq ${f} | xargs -r docker rm -f >/dev/null 2>&1; ` +
    `docker network ls -q ${f} | xargs -r docker network rm >/dev/null 2>&1; ` +
    `docker volume ls -q ${f} | xargs -r docker volume rm >/dev/null 2>&1 || true`
  );
}

/** `docker exec` target for scheduled tasks: the first container of the exposed service (or of the project). */
export function composeExecCommand(project: string, service: string | null, command: string): string {
  return (
    `c=$(docker ps -q ${projectFilter(project, service)} | head -n 1); ` +
    `[ -n "$c" ] || { echo "nenhum container em execução${service ? ` para o serviço ${service}` : ""}"; exit 1; }; ` +
    `docker exec "$c" sh -c ${shellQuote(command)}`
  );
}

/**
 * The override compose file that routes a service through the Traefik proxy. Compose merges labels
 * and networks from every -f file, so the user's own definitions stay untouched. `labels` come from
 * traefikLabels() (shared/traefik.ts).
 */
export function composeProxyOverride(service: string, labels: string[]): string {
  const q = (s: string) => JSON.stringify(s);
  return [
    "services:",
    `  ${service}:`,
    "    networks:",
    "      - default",
    `      - ${q(PROXY_NETWORK_NAME)}`,
    "    labels:",
    // Compose interpolates ${...} in the file, so a literal $ in a label (the redirect's ${1}) is written $.
    ...labels.map((l) => `      - ${q(l.split("$").join("$"))}`),
    "networks:",
    `  ${q(PROXY_NETWORK_NAME)}:`,
    "    external: true",
    "",
  ].join("\n");
}
