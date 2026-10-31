// Pure version-comparison logic, split out from updates.ts so unit tests can import it without
// pulling in updates.ts's route-level imports — notably ../lib/queue, which constructs real
// BullMQ Queue/ioredis instances at module load time (fine in the running API, but a real
// connection attempt against the fake test REDIS_URL fires an async error later in the test run,
// after some other test has temporarily unset console.error, crashing the whole suite). Same
// pattern already used for the worker's *.commands.ts files — see CONTRIBUTING.md.

export interface ParsedVersionTag {
  hasV: boolean;
  parts: number[];
  suffix: string;
}

/** "16-alpine" → {parts:[16], suffix:"-alpine"}. "v2.11" → {hasV:true, parts:[2,11], suffix:""}. */
export function parseVersionTag(tag: string): ParsedVersionTag | null {
  const match = /^(v)?(\d+(?:\.\d+){0,3})(.*)$/.exec(tag);
  if (!match) return null;
  return { hasV: Boolean(match[1]), parts: match[2]!.split(".").map(Number), suffix: match[3] ?? "" };
}

export function compareVersionParts(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
