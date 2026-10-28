// Is the proxy (Traefik) behind the newest patch of the minor line yeah provisions (v2.11)?

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

export function traefikVersionCommand(containerName: string): string {
  return `docker exec ${containerName} traefik version 2>&1`;
}

/** "Version:      2.11.14\n..." (or a tag like v2.11.14) → {2, 11, 14}. */
export function parseSemVer(text: string): SemVer | null {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(text);
  return m ? { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) } : null;
}

export const formatSemVer = (v: SemVer) => `${v.major}.${v.minor}.${v.patch}`;

/** Newest release tag on the same major.minor line, ignoring pre-releases (rc, beta…). */
export function latestPatch(tags: string[], line: { major: number; minor: number }): SemVer | null {
  let best: SemVer | null = null;
  for (const tag of tags) {
    if (/-/.test(tag)) continue;
    const v = parseSemVer(tag);
    if (!v || v.major !== line.major || v.minor !== line.minor) continue;
    if (!best || v.patch > best.patch) best = v;
  }
  return best;
}

export function isBehind(current: SemVer, latest: SemVer): boolean {
  return latest.major === current.major && latest.minor === current.minor && latest.patch > current.patch;
}
