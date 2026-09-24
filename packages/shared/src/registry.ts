import { shellQuote } from "./shell";

// Private container registries (Docker Hub, GHCR, self-hosted…): log in before pulling an image,
// and for built applications push the result tagged with the commit — so a rollback or a second
// server reuses the image instead of building it again.

/** host[:port] of the registry, no scheme and no path ("ghcr.io", "registry.example.com:5000", "docker.io"). */
export function isValidRegistryHost(host: string): boolean {
  return host.length <= 253 && /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?$/i.test(host);
}

/** Repository path inside the registry ("org/app"): lowercase name components separated by "/". */
export function isValidRegistryRepository(repo: string): boolean {
  return repo.length <= 255 && /^[a-z0-9]+([._-][a-z0-9]+)*(\/[a-z0-9]+([._-][a-z0-9]+)*)*$/.test(repo);
}

/** Registry usernames are shown in commands (quoted); keep them to visible, non-space characters. */
export function isValidRegistryUsername(user: string): boolean {
  return user.length >= 1 && user.length <= 255 && /^[^\s\x00-\x1f]+$/.test(user);
}

/**
 * The tag for an image built from `commitSha` (short) — or from a deployment when there is no Git commit.
 * `variant` (a short digest of the build-time variables) is appended so changing a build arg never reuses
 * an image built with the old one.
 */
export function registryTag(commitSha: string | null, deploymentId: string, variant?: string): string {
  const sha = commitSha?.trim();
  const base = sha && /^[0-9a-f]{7,40}$/i.test(sha) ? sha.slice(0, 12).toLowerCase() : `d-${deploymentId.replace(/-/g, "").slice(0, 12)}`;
  return variant ? `${base}-${variant}` : base;
}

export function registryRef(host: string, repository: string, tag: string): string {
  return `${host}/${repository}:${tag}`;
}

/**
 * Logs in reading the password from a file the job wrote (never on the command line, where \`ps\` on the
 * server could see it) and removes that file whatever the outcome.
 */
export function registryLoginCommand(host: string, username: string, passwordFile: string): string {
  return `docker login ${shellQuote(host)} -u ${shellQuote(username)} --password-stdin < ${shellQuote(passwordFile)}; rc=$?; rm -f ${shellQuote(passwordFile)}; exit $rc`;
}

export function registryLogoutCommand(host: string): string {
  return `docker logout ${shellQuote(host)} >/dev/null 2>&1 || true`;
}

/**
 * Exit 0 when the exact tag exists in the registry — and, as a side effect, the image is now local.
 * A real `docker pull` on purpose (not `docker manifest inspect`): it follows the daemon's own rules for
 * insecure/plain-HTTP registries and credentials, so the check and the later pull can never disagree.
 */
export function registryExistsCommand(ref: string): string {
  return `docker pull -q ${shellQuote(ref)} >/dev/null 2>&1`;
}

/** Gives an already-pulled image the local name the run step uses. */
export function registryTagLocalCommand(ref: string, localImage: string): string {
  return `docker tag ${shellQuote(ref)} ${shellQuote(localImage)}`;
}

/** After a build: tag the local image with the registry reference and push it. */
export function registryPushCommand(localImage: string, ref: string): string {
  return `docker tag ${shellQuote(localImage)} ${shellQuote(ref)} && docker push ${shellQuote(ref)}`;
}
