import type { Application, Server } from "@yeah/db";
import { PROXY_NETWORK_NAME, resourceLimitFlags, shellQuote } from "@yeah/shared";

// Pure command-building logic lives in its own file, separate from deployApplication.ts's actual
// SSH execution — importing @yeah/ssh (even just for shellQuote, which has zero SSH dependency of
// its own) pulls in the ssh2 package's module-level side effects, which is unnecessary weight for
// something that's just string construction and makes this logic awkward to unit test in
// isolation. See apps/worker/src/jobs/deployApplication.ts, which re-exports these.

/** null means "publish the port directly on the host" — the original, proxy-less behavior. */
export function resolveDomain(application: Application, server: Server): string | null {
  if (application.domain) return application.domain;
  if (server.proxyStatus !== "active" || !server.wildcardDomain) return null;
  const slug = application.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${slug}.${server.wildcardDomain}`;
}

export function buildRunCommand(application: Application, appDir: string, containerName: string, domain: string | null): string {
  const base =
    `docker run -d --name ${shellQuote(containerName)} --env-file ${shellQuote(`${appDir}/.env`)} ` +
    resourceLimitFlags(application);
  const restart = `--restart unless-stopped ${shellQuote(containerName)}`;

  if (!domain) {
    return base + `-p ${application.port}:${application.port} ` + restart;
  }

  return (
    base +
    `--network ${shellQuote(PROXY_NETWORK_NAME)} ` +
    `--label traefik.enable=true ` +
    `--label ${shellQuote(`traefik.http.routers.${containerName}.rule=Host(\`${domain}\`)`)} ` +
    `--label traefik.http.routers.${containerName}.entrypoints=websecure ` +
    `--label traefik.http.routers.${containerName}.tls.certresolver=letsencrypt ` +
    `--label traefik.http.services.${containerName}.loadbalancer.server.port=${application.port} ` +
    restart
  );
}
