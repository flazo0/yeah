// Pure command builder and output parser for `docker system prune` — kept separate from
// dockerCleanup.ts so it can be unit tested without loading ssh2 (same split as the other jobs).

export interface DockerCleanupOptions {
  /** `-a`: also removes unused images, not just dangling ones. */
  pruneImages: boolean;
  /** `--volumes`: also removes unused volumes — anonymous *and* named, which can drop real data. */
  pruneVolumes: boolean;
  /**
   * Set when some images are protected (the rollback images of applications that keep them): the ids of
   * the unused, unprotected images to delete. Then `-a` is dropped from the prune and these are removed
   * one by one instead, so the protected images survive. Undefined = plain `docker system prune -a`.
   */
  removeImageIds?: string[];
}

/** `docker system prune -f`, with the two opt-in flags appended in a stable order. */
export function buildDockerPruneCommand(opts: DockerCleanupOptions): string {
  let cmd = "docker system prune -f";
  if (opts.pruneImages && opts.removeImageIds === undefined) cmd += " -a";
  if (opts.pruneVolumes) cmd += " --volumes";
  return cmd;
}

/** The selective image removal that replaces `-a` when images are protected; null when not applicable. */
export function buildImageRemovalCommand(opts: DockerCleanupOptions): string | null {
  if (!opts.pruneImages || opts.removeImageIds === undefined || opts.removeImageIds.length === 0) return null;
  const ids = opts.removeImageIds.filter((id) => /^[0-9a-f]{12,64}$/.test(id));
  if (ids.length === 0) return null;
  return `(docker image rm ${ids.join(" ")} >/dev/null 2>&1 || true)`;
}

/**
 * The whole daily housekeeping, in one SSH command: the prune above, then build cache older than 3 days
 * (a plain `system prune` leaves most of it — `yeah update` builds alone pile up gigabytes), then the
 * host's own journal older than 14 days and the apt package cache. Each extra step is best-effort so
 * a missing `journalctl`/`apt-get` (non-Debian host) never fails the run.
 */
export function buildHostCleanupCommand(opts: DockerCleanupOptions): string {
  return [
    buildDockerPruneCommand(opts),
    ...(buildImageRemovalCommand(opts) ? [buildImageRemovalCommand(opts)!] : []),
    "docker builder prune -f --filter until=72h",
    "(journalctl --vacuum-time=14d >/dev/null 2>&1 || true)",
    "(apt-get clean >/dev/null 2>&1 || true)",
  ].join(" ; ");
}

const RECLAIMED_LINE = /Total reclaimed space:\s*([\d.]+)\s*(B|KB|MB|GB|TB)/gi;
const UNITS: Record<string, number> = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 };

/** Sums every "Total reclaimed space: X MB" line (system prune and builder prune each print one) into bytes; null if none. */
export function parseReclaimedBytes(output: string): number | null {
  let total = 0;
  let found = false;
  for (const match of output.matchAll(RECLAIMED_LINE)) {
    const amount = Number.parseFloat(match[1]!);
    const unit = UNITS[match[2]!.toUpperCase()];
    if (!Number.isFinite(amount) || !unit) continue;
    total += amount * unit;
    found = true;
  }
  return found ? Math.round(total) : null;
}
