import { PROXY_DIR, WAKER_CONTAINER_NAME, WAKER_PORT } from "./constants";
import { shellQuote } from "./shell";
import type { StackDomain } from "./composeStack";
import { computeRouting, traefikDynamicConfig } from "./traefik";

// Maintenance mode for services and compose stacks. Applications put the waker in front of their own router; a
// service's routers come from Docker labels inside the compose override (recreated only on deploy), so instead a
// File Provider router with a higher priority claims the same hostnames and sends them to the waker, which answers
// 503 with the maintenance page (apps/worker/src/lib/waker.cjs). The stack itself is never touched, and turning
// maintenance off just deletes the two files again.

export const MAINTENANCE_MESSAGE_MAX = 500;

/** Name shared by the router, the wake entry and both file names for a service's maintenance routing. */
export function serviceMaintenanceName(serviceId: string): string {
  return `yeah-svc-${serviceId}-maint`;
}

/** `rm -f` of a service's two maintenance files (router in the proxy's dynamic dir, entry in the waker's wake dir). */
export function removeServiceMaintenanceCommand(serviceId: string): string {
  const name = serviceMaintenanceName(serviceId);
  return `rm -f ${shellQuote(`${PROXY_DIR}/dynamic/${name}.yml`)} ${shellQuote(`${PROXY_DIR}/wake/${name}.json`)}`;
}

export interface ServiceMaintenanceInput {
  /** The single domain of a legacy one-container service (already resolved, wildcard included); null when it has none. */
  domain: string | null;
  /** Per-container domains of a stack. */
  domains: StackDomain[];
  /** Compose services in maintenance; empty = every container with a domain. Ignored for legacy single-container services. */
  containers: string[];
  isStack: boolean;
}

/** Hostnames to put into maintenance (deduplicated, stable order). */
export function serviceMaintenanceHosts(input: ServiceMaintenanceInput): string[] {
  if (!input.isStack) return input.domain ? [input.domain] : [];
  const only = new Set(input.containers);
  const hosts = input.domains.filter((d) => only.size === 0 || only.has(d.service)).map((d) => d.domain);
  return [...new Set(hosts)];
}

/** Drops names that are not compose services of the stack. */
export function sanitizeMaintenanceContainers(containers: string[], stackServices: string[]): string[] {
  return [...new Set(containers.filter((c) => stackServices.includes(c)))];
}

/** Traefik File Provider YAML claiming `hosts` and forwarding them to the waker; null when there is nothing to claim. */
export function serviceMaintenanceDynamicConfig(serviceId: string, hosts: string[]): string | null {
  if (hosts.length === 0) return null;
  const routing = computeRouting(hosts[0] as string, hosts.slice(1), "none");
  return traefikDynamicConfig(serviceMaintenanceName(serviceId), routing, WAKER_PORT, { backendUrl: `http://${WAKER_CONTAINER_NAME}:${WAKER_PORT}` });
}
