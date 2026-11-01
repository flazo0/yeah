import { writeRemoteFile, execStream, type Client } from "@yeah/ssh";
import { PROXY_DIR, removeServiceMaintenanceCommand, serviceMaintenanceDynamicConfig, serviceMaintenanceHosts, serviceMaintenanceName } from "@yeah/shared";
import type { Server, Service } from "@yeah/db";
import { installWaker } from "./appRouting";
import { wakeConfigJson, wakeConfigPath } from "./waker.commands";
import { resolveDomain } from "../jobs/provisionService.commands";

export function serviceMaintenanceDynamicPath(serviceId: string): string {
  return `${PROXY_DIR}/dynamic/${serviceMaintenanceName(serviceId)}.yml`;
}

/** The files to write for a service in maintenance mode, or null when it is off or has no domain to claim. */
export function serviceMaintenanceFiles(service: Service, server: Server): { dynamicYaml: string; wakeJson: string } | null {
  if (!service.maintenanceMode) return null;
  const hosts = serviceMaintenanceHosts({ domain: resolveDomain(service, server), domains: service.domains, containers: service.maintenanceContainers, isStack: Boolean(service.composeContent) });
  const dynamicYaml = serviceMaintenanceDynamicConfig(service.id, hosts);
  if (!dynamicYaml) return null;
  // The waker answers 503 before it ever touches the container, so the name only identifies the entry.
  return { dynamicYaml, wakeJson: wakeConfigJson(serviceMaintenanceName(service.id), hosts, 80, null, service.maintenanceMessage ?? "") };
}

/** Applies maintenance mode to the proxy without touching the stack (the router files are removed when it is off). */
export async function applyServiceMaintenance(conn: Client, service: Service, server: Server): Promise<void> {
  const files = serviceMaintenanceFiles(service, server);
  if (!files) {
    await execStream(conn, removeServiceMaintenanceCommand(service.id), () => undefined);
    return;
  }
  await installWaker(conn);
  await writeRemoteFile(conn, wakeConfigPath(serviceMaintenanceName(service.id)), files.wakeJson);
  await writeRemoteFile(conn, serviceMaintenanceDynamicPath(service.id), files.dynamicYaml);
}
