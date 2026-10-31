// Pure command builder and output parser for `docker system prune` — kept separate from
// dockerCleanup.ts so it can be unit tested without loading ssh2 (same split as the other jobs).

export interface DockerCleanupOptions {
  /** `-a`: also removes unused images, not just dangling ones. */
  pruneImages: boolean;
  /** `--volumes`: also removes unused volumes — anonymous *and* named, which can drop real data. */
  pruneVolumes: boolean;
}

/** `docker system prune -f`, with the two opt-in flags appended in a stable order. */
export function buildDockerPruneCommand(opts: DockerCleanupOptions): string {
  let cmd = "docker system prune -f";
  if (opts.pruneImages) cmd += " -a";
  if (opts.pruneVolumes) cmd += " --volumes";
  return cmd;
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
