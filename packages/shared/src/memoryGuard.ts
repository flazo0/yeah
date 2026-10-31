// Memory guard: when a server runs low on RAM, stop the least important applications/services first so the
// ones that matter stay online, and start them again once there is room. Opt-in per server.
//
// Everything here is pure (no SSH, no database) so the policy can be tested; the worker feeds it the
// latest memory sample and the server's resources, and carries out the action it returns.

export const GUARD_PRIORITIES = ["critical", "normal", "low"] as const;
export type GuardPriority = (typeof GUARD_PRIORITIES)[number];

export function isGuardPriority(value: unknown): value is GuardPriority {
  return typeof value === "string" && (GUARD_PRIORITIES as readonly string[]).includes(value);
}

export const MEMORY_GUARD_DEFAULTS = { threshold: 92, recover: 80 } as const;
/** Smallest gap between the two limits: without it a restart could push memory straight back over the threshold. */
export const MEMORY_GUARD_MIN_GAP = 5;
/** Consecutive samples (one per minute) over the threshold before something is stopped. */
export const SHED_AFTER_SAMPLES = 2;
/** Consecutive samples under the recover limit before something is started again. */
export const RESTORE_AFTER_SAMPLES = 3;

export interface MemoryGuardSettings {
  enabled: boolean;
  /** Stop something when memory use is at or above this percentage. */
  threshold: number;
  /** Start things stopped by the guard again once memory use is at or below this percentage. */
  recover: number;
}

/** Validates the two limits; the message is for the user. */
export function validateMemoryGuardLimits(threshold: number, recover: number): string | null {
  if (!Number.isInteger(threshold) || threshold < 70 || threshold > 99) return "the stop threshold must be a whole number between 70 and 99";
  if (!Number.isInteger(recover) || recover < 40) return "the recover level must be a whole number of at least 40";
  if (recover > threshold - MEMORY_GUARD_MIN_GAP) return `the recover level must be at least ${MEMORY_GUARD_MIN_GAP} points below the stop threshold`;
  return null;
}

export interface GuardCandidate {
  kind: "application" | "service";
  id: string;
  name: string;
  priority: GuardPriority;
  /** Memory the resource uses right now (bytes), when known. */
  memBytes: number | null;
  /** True while the guard is the reason it is stopped. */
  shedByGuard: boolean;
  status: "running" | "stopped" | "other";
}

const TIER: Record<GuardPriority, number> = { low: 0, normal: 1, critical: 2 };

/** The running resource to stop first: lowest priority, then the biggest memory user. Critical ones never qualify. */
export function pickToShed(candidates: GuardCandidate[]): GuardCandidate | null {
  const eligible = candidates.filter((c) => c.status === "running" && c.priority !== "critical" && !c.shedByGuard);
  eligible.sort((a, b) => TIER[a.priority] - TIER[b.priority] || (b.memBytes ?? -1) - (a.memBytes ?? -1) || a.name.localeCompare(b.name));
  return eligible[0] ?? null;
}

/** The resource the guard stopped that should come back first: the most important one. */
export function pickToRestore(candidates: GuardCandidate[]): GuardCandidate | null {
  const stopped = candidates.filter((c) => c.shedByGuard && c.status === "stopped");
  stopped.sort((a, b) => TIER[b.priority] - TIER[a.priority] || a.name.localeCompare(b.name));
  return stopped[0] ?? null;
}

export interface GuardState {
  high: number;
  low: number;
}
export const INITIAL_GUARD_STATE: GuardState = { high: 0, low: 0 };

export type GuardAction = { type: "stop"; target: GuardCandidate } | { type: "start"; target: GuardCandidate } | { type: "none" };

/**
 * One tick of the policy. Needs a few samples in a row before acting and acts on one resource at a time, then
 * starts counting again, so a spike never empties the server and a restart cannot be followed by another
 * instantly. Anything off (guard disabled, nothing to stop) resets the counters.
 */
export function guardStep(state: GuardState, memPercent: number, settings: MemoryGuardSettings, candidates: GuardCandidate[]): { state: GuardState; action: GuardAction } {
  if (!settings.enabled) return { state: INITIAL_GUARD_STATE, action: { type: "none" } };

  if (memPercent >= settings.threshold) {
    const high = state.high + 1;
    if (high >= SHED_AFTER_SAMPLES) {
      const target = pickToShed(candidates);
      if (target) return { state: INITIAL_GUARD_STATE, action: { type: "stop", target } };
    }
    return { state: { high, low: 0 }, action: { type: "none" } };
  }

  if (memPercent <= settings.recover) {
    const low = state.low + 1;
    if (low >= RESTORE_AFTER_SAMPLES) {
      const target = pickToRestore(candidates);
      if (target) return { state: INITIAL_GUARD_STATE, action: { type: "start", target } };
    }
    return { state: { high: 0, low }, action: { type: "none" } };
  }

  // Between the two limits: hold still, and let both streaks start over.
  return { state: INITIAL_GUARD_STATE, action: { type: "none" } };
}
