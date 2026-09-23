import type { Application, Server } from "@yeah/db";
import { PROXY_NETWORK_NAME, parseDockerOptions, resourceLimitFlags, resourceSlug, shellQuote, volumeFlags } from "@yeah/shared";

// Pure command-building logic lives in its own file, separate from deployApplication.ts's actual
// SSH execution — importing @yeah/ssh (even just for shellQuote, which has zero SSH dependency of
// its own) pulls in the ssh2 package's module-level side effects, which is unnecessary weight for
// something that's just string construction and makes this logic awkward to unit test in
// isolation. See apps/worker/src/jobs/deployApplication.ts, which re-exports these.

/** null means "publish the port directly on the host" — the original, proxy-less behavior. */
export function resolveDomain(application: Application, server: Server): string | null {
  if (application.domain) return application.domain;
  if (server.proxyStatus !== "active" || !server.wildcardDomain) return null;
  return `${resourceSlug(application.name)}.${server.wildcardDomain}`;
}

/**
 * Clones (first deploy) or fetches+resets (every deploy after) the app's repo. `targetCommitSha`
 * is null for a normal deploy (reset to the branch's current HEAD) or set for a rollback (reset to
 * that exact commit instead) — `git reset --hard` accepts either a ref or a raw SHA and works
 * identically whether the repo is currently on a branch or in detached HEAD from a prior rollback,
 * so no separate checkout/re-attach step is needed either way.
 */
export function buildCloneOrPullCommand(appDir: string, cloneUrl: string, branch: string, targetCommitSha: string | null): string {
  const ref = targetCommitSha ?? `origin/${branch}`;
  return (
    `cd ${shellQuote(appDir)} && ` +
    `(test -d repo/.git && (cd repo && git remote set-url origin ${shellQuote(cloneUrl)} && git fetch origin ${shellQuote(branch)} && git reset --hard ${shellQuote(ref)}) ` +
    `|| (git clone --branch ${shellQuote(branch)} --single-branch ${shellQuote(cloneUrl)} repo && cd repo && git reset --hard ${shellQuote(ref)}))`
  );
}

/**
 * Docker's own healthcheck: runs inside the container, so it needs curl or wget in the image (one of
 * the two is enough). Empty when no path is configured.
 */
export function healthFlags(application: Application): string {
  if (!application.healthPath) return "";
  // 127.0.0.1 first: an app bound to IPv4 only is unreachable through "localhost" when that resolves to ::1.
  const urls = [`http://127.0.0.1:${application.port}${application.healthPath}`, `http://localhost:${application.port}${application.healthPath}`];
  const probe = `${urls.map((url) => `curl -fsS ${url} >/dev/null 2>&1 || wget -q -O /dev/null ${url} >/dev/null 2>&1`).join(" || ")} || exit 1`;
  return (
    `--health-cmd ${shellQuote(probe)} ` +
    `--health-interval ${application.healthIntervalSeconds}s ` +
    `--health-timeout ${application.healthTimeoutSeconds}s ` +
    `--health-retries ${application.healthRetries} ` +
    `--health-start-period ${application.healthStartPeriodSeconds}s `
  );
}

/** The user's extra `docker run` flags, each word shell-quoted. Invalid input was already rejected at save time. */
export function dockerOptionsFlags(application: Application): string {
  const parsed = parseDockerOptions(application.dockerOptions ?? "");
  if (!parsed.ok || parsed.args.length === 0) return "";
  return `${parsed.args.map(shellQuote).join(" ")} `;
}

/** Graceful stop (SIGTERM, then SIGKILL after the grace period) followed by removal — no-op if it doesn't exist. */
export function buildStopOldCommand(containerName: string, graceSeconds: number): string {
  const name = shellQuote(containerName);
  return `docker stop -t ${Math.max(0, Math.floor(graceSeconds))} ${name} >/dev/null 2>&1; docker rm -f ${name} >/dev/null 2>&1 || true`;
}

/**
 * Waits for the container's healthcheck to turn healthy. Exit 0 = healthy, 1 = unhealthy or the
 * container died, 2 = still starting when the time ran out. On failure the last log lines are printed.
 */
export function buildHealthWaitCommand(containerName: string, maxSeconds: number): string {
  const name = shellQuote(containerName);
  const rounds = Math.max(1, Math.ceil(maxSeconds / 2));
  return (
    `rc=2; for i in $(seq 1 ${rounds}); do ` +
    `running=$(docker inspect -f '{{.State.Running}}' ${name} 2>/dev/null); ` +
    `status=$(docker inspect -f '{{.State.Health.Status}}' ${name} 2>/dev/null); ` +
    `if [ "$status" = healthy ]; then rc=0; break; fi; ` +
    `if [ "$status" = unhealthy ] || [ "$running" = false ]; then rc=1; break; fi; ` +
    `sleep 2; done; ` +
    `if [ $rc -ne 0 ]; then echo "healthcheck: status=$status (rc=$rc) — últimas linhas do container:"; docker logs --tail 40 ${name} 2>&1; fi; exit $rc`
  );
}

export function healthWaitSeconds(application: Application): number {
  return application.healthStartPeriodSeconds + application.healthIntervalSeconds * application.healthRetries + 30;
}

export function buildRunCommand(
  application: Application,
  appDir: string,
  containerName: string,
  domain: string | null,
  volumes: Array<{ id: string; mountPath: string }> = [],
): string {
  const base =
    `docker run -d --name ${shellQuote(containerName)} --env-file ${shellQuote(`${appDir}/.env`)} ` +
    resourceLimitFlags(application) +
    volumeFlags(volumes) +
    healthFlags(application) +
    dockerOptionsFlags(application);
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
