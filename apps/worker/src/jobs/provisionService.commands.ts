import type { Server, Service } from "@yeah/db";
import { composeProjectName, findServiceCatalogEntry, PROXY_NETWORK_NAME, resourceLimitFlags, shellQuote } from "@yeah/shared";

// Pure command-building logic, kept separate from provisionService.ts's SSH execution for the
// same reason as deployApplication.commands.ts — see that file's comment.

export function containerNameForService(serviceId: string): string {
  return `yeah-svc-${serviceId}`;
}

/** null means "publish the port directly on the host" — same rule as applications. */
export function resolveDomain(service: Service, server: Server): string | null {
  if (service.domain) return service.domain;
  if (server.proxyStatus !== "active" || !server.wildcardDomain) return null;
  const slug = service.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${slug}.${server.wildcardDomain}`;
}

export function buildRunCommand(service: Service, containerName: string, envFilePath: string, domain: string | null): string {
  const catalogEntry = findServiceCatalogEntry(service.catalogKey);
  const volumeFlag = catalogEntry?.volumePath ? `-v ${shellQuote(`${containerName}-data`)}:${shellQuote(catalogEntry.volumePath)} ` : "";
  const base =
    `docker run -d --name ${shellQuote(containerName)} --env-file ${shellQuote(envFilePath)} ${volumeFlag}` +
    resourceLimitFlags(service);
  const restart = `--restart unless-stopped ${shellQuote(service.image)}`;

  if (!domain) {
    return base + `-p ${service.port}:${service.port} ` + restart;
  }

  return (
    base +
    `--network ${shellQuote(PROXY_NETWORK_NAME)} ` +
    `--label traefik.enable=true ` +
    `--label ${shellQuote(`traefik.http.routers.${containerName}.rule=Host(\`${domain}\`)`)} ` +
    `--label traefik.http.routers.${containerName}.entrypoints=websecure ` +
    `--label traefik.http.routers.${containerName}.tls.certresolver=letsencrypt ` +
    `--label traefik.http.services.${containerName}.loadbalancer.server.port=${service.port} ` +
    restart
  );
}

// ---- stacks (compose) ----

export const stackProject = (serviceId: string) => `yeah-svc-${serviceId}`;
export const stackDir = (serviceId: string) => `/opt/yeah-services/${serviceId}`;
export const STACK_OVERRIDE_FILE = "compose.yeah.override.yml";

/** `docker compose up` for the service's project: waits for every container to be running (or healthy). */
export function buildStackUpCommand(serviceId: string, waitSeconds = 300): string {
  const dir = stackDir(serviceId);
  return (
    `cd ${shellQuote(dir)} && docker compose -p ${shellQuote(stackProject(serviceId))} --env-file .env -f docker-compose.yml -f ${STACK_OVERRIDE_FILE} ` +
    `up -d --remove-orphans --wait --wait-timeout ${Math.max(30, Math.floor(waitSeconds))}`
  );
}

/** Pulls the images first so a slow download is not counted against the "wait for healthy" timeout. */
export function buildStackPullCommand(serviceId: string): string {
  const dir = stackDir(serviceId);
  return `cd ${shellQuote(dir)} && docker compose -p ${shellQuote(stackProject(serviceId))} --env-file .env -f docker-compose.yml pull --quiet`;
}

void composeProjectName;
