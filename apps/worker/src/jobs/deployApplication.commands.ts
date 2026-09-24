import type { Application, Server } from "@yeah/db";
import type { EnvEntry } from "@yeah/shared";
import { composeProjectName, computeRouting, normalizeHost, PROXY_NETWORK_NAME, traefikLabels, isSafePublishDirectory, parseDockerOptions, resourceLimitFlags, resourceSlug, shellQuote, volumeFlags } from "@yeah/shared";

// Pure command-building logic lives in its own file, separate from deployApplication.ts's actual
// SSH execution — importing @yeah/ssh (even just for shellQuote, which has zero SSH dependency of
// its own) pulls in the ssh2 package's module-level side effects, which is unnecessary weight for
// something that's just string construction and makes this logic awkward to unit test in
// isolation. See apps/worker/src/jobs/deployApplication.ts, which re-exports these.

/** null means "publish the port directly on the host" — the original, proxy-less behavior. */
export function resolveDomain(application: Application, server: Server): string | null {
  if (application.domain) return normalizeHost(application.domain);
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
export function buildCloneOrPullCommand(
  appDir: string,
  cloneUrl: string,
  branch: string,
  targetCommitSha: string | null,
  sshKeyPath: string | null = null,
): string {
  const ref = targetCommitSha ?? `origin/${branch}`;
  // Deploy key: git talks SSH with exactly that key; new host keys are accepted the first time, then pinned.
  const sshEnv = sshKeyPath
    ? `export GIT_SSH_COMMAND=${shellQuote(`ssh -i ${sshKeyPath} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new`)} && `
    : "";
  return (
    sshEnv +
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
  imageRef: string = containerName,
): string {
  const base =
    `docker run -d --name ${shellQuote(containerName)} --env-file ${shellQuote(`${appDir}/.env`)} ` +
    resourceLimitFlags(application) +
    volumeFlags(volumes) +
    healthFlags(application) +
    dockerOptionsFlags(application);
  const restart = `--restart unless-stopped ${shellQuote(imageRef)}`;

  if (!domain) {
    return base + `-p ${application.port}:${application.port} ` + restart;
  }

  const labels = traefikLabels(containerName, computeRouting(domain, application.extraDomains, application.wwwRedirect), application.port);
  return base + `--network ${shellQuote(PROXY_NETWORK_NAME)} ` + labels.map((l) => `--label ${shellQuote(l)} `).join("") + restart;
}

export interface BuildStep {
  label: string;
  command: string;
}

/** The nginx image a static site is served from. */
export const STATIC_BASE_IMAGE = "nginx:alpine";

export function staticDockerfile(publishDirectory: string): string {
  const source = publishDirectory === "" ? "." : publishDirectory;
  return `FROM ${STATIC_BASE_IMAGE}\nCOPY ["${source}", "/usr/share/nginx/html"]\nEXPOSE 80\n`;
}

/**
 * How the image gets produced for each build pack. Git-based packs run inside the freshly cloned repo,
 * "image" only pulls, and "dockerfile_inline" builds from a directory holding just the pasted Dockerfile
 * (written by the job before these steps run) so nothing else is sent as build context.
 */
export function buildImageSteps(
  application: Application,
  repoDir: string,
  inlineDir: string,
  imageName: string,
  buildEnv: EnvEntry[] = [],
): BuildStep[] {
  const image = shellQuote(imageName);
  const buildArgs = buildEnv.map((e) => `--build-arg ${shellQuote(`${e.key}=${e.value}`)} `).join("");
  const nixEnv = buildEnv.map((e) => ` --env ${shellQuote(`${e.key}=${e.value}`)}`).join("");
  switch (application.buildPack) {
    case "image":
      return [{ label: `baixando a imagem ${application.dockerImage}`, command: `docker pull ${shellQuote(application.dockerImage ?? "")}` }];
    case "dockerfile_inline":
      return [{ label: "construindo a imagem (Dockerfile colado)", command: `docker build ${buildArgs}-t ${image} ${shellQuote(inlineDir)}` }];
    case "static":
      return [
        {
          label: `construindo o site estático (${application.publishDirectory || "."} → nginx)`,
          command: `cd ${shellQuote(repoDir)} && printf %s ${shellQuote(staticDockerfile(application.publishDirectory))} | docker build -t ${image} -f - .`,
        },
      ];
    case "nixpacks":
      return [
        {
          label: "garantindo o nixpacks no servidor",
          command: "command -v nixpacks >/dev/null 2>&1 || (curl -sSL https://nixpacks.com/install.sh | bash)",
        },
        { label: "construindo com nixpacks (detecta a linguagem)", command: `nixpacks build ${shellQuote(repoDir)} --name ${image}${nixEnv}` },
      ];
    default:
      return [{ label: "construindo a imagem", command: `cd ${shellQuote(repoDir)} && docker build ${buildArgs}-t ${image} .` }];
  }
}

/** Every variable, build-time ones included: compose interpolates `${VAR}` in the file at build too. */
export function composeEnvFile(entries: EnvEntry[]): string {
  return entries.length > 0 ? `${entries.map((e) => `${e.key}=${e.value}`).join("\n")}\n` : "";
}

export const COMPOSE_OVERRIDE_FILE = "compose.yeah.override.yml";

/**
 * `docker compose up` for the application's project. --wait makes it block until every service is
 * running (or healthy, when the file declares a healthcheck) and fail otherwise; --remove-orphans drops
 * services that left the file.
 */
export function buildComposeUpCommand(application: Application, appDir: string, repoDir: string, withOverride: boolean, waitSeconds: number): string {
  const files = `-f ${shellQuote(application.composeFile)}` + (withOverride ? ` -f ${shellQuote(`${appDir}/${COMPOSE_OVERRIDE_FILE}`)}` : "");
  return (
    `cd ${shellQuote(repoDir)} && docker compose -p ${shellQuote(composeProjectName(application.id))} ` +
    `--env-file ${shellQuote(`${appDir}/.env`)} ${files} up -d --build --remove-orphans --wait --wait-timeout ${Math.max(10, Math.floor(waitSeconds))}`
  );
}

export { isSafePublishDirectory };
