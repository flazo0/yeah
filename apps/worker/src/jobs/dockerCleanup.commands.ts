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

const RECLAIMED_LINE = /Total reclaimed space:\s*([\d.]+)\s*(B|KB|MB|GB|TB)/i;
const UNITS: Record<string, number> = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 };

/** Parses `docker system prune`'s closing "Total reclaimed space: X MB" line into bytes; null if not found. */
export function parseReclaimedBytes(output: string): number | null {
  const match = RECLAIMED_LINE.exec(output);
  if (!match) return null;
  const amount = Number.parseFloat(match[1]!);
  const unit = UNITS[match[2]!.toUpperCase()];
  if (!Number.isFinite(amount) || !unit) return null;
  return Math.round(amount * unit);
}
