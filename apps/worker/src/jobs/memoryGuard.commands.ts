import type { GuardCandidate, GuardPriority } from "@yeah/shared";

// Pure part of the memory guard job: turns database rows plus the containers that are really running into the
// candidates the policy (packages/shared/src/memoryGuard.ts) chooses from.

export interface GuardAppRow {
  id: string;
  name: string;
  priority: GuardPriority;
  shedByGuard: boolean;
  status: string;
  /** docker_compose applications run several containers, so their container name is not predictable. */
  isCompose: boolean;
}

export interface GuardServiceRow {
  id: string;
  name: string;
  priority: GuardPriority;
  shedByGuard: boolean;
  status: string;
  /** Stacks (a pasted compose file) run several containers. */
  isStack: boolean;
}

export interface RunningContainer {
  name: string;
  memUsedBytes: number | null;
}

const asStatus = (status: string): GuardCandidate["status"] => (status === "running" ? "running" : status === "stopped" ? "stopped" : "other");

/**
 * A single-container resource only counts as running when its container is there: an application that scale to
 * zero put to sleep is "running" in the database but uses no memory, and stopping (or later starting) it would
 * be wrong. Multi-container resources are judged by their status alone.
 */
export function buildGuardCandidates(apps: GuardAppRow[], services: GuardServiceRow[], running: RunningContainer[]): GuardCandidate[] {
  const byName = new Map(running.map((c) => [c.name, c]));
  const out: GuardCandidate[] = [];
  for (const a of apps) {
    const container = a.isCompose ? undefined : byName.get(`yeah-app-${a.id}`);
    let status = asStatus(a.status);
    if (status === "running" && !a.isCompose && !container) status = "other";
    out.push({ kind: "application", id: a.id, name: a.name, priority: a.priority, memBytes: container?.memUsedBytes ?? null, shedByGuard: a.shedByGuard, status });
  }
  for (const s of services) {
    const container = s.isStack ? undefined : byName.get(`yeah-svc-${s.id}`);
    let status = asStatus(s.status);
    if (status === "running" && !s.isStack && !container) status = "other";
    out.push({ kind: "service", id: s.id, name: s.name, priority: s.priority, memBytes: container?.memUsedBytes ?? null, shedByGuard: s.shedByGuard, status });
  }
  return out;
}

/** Resources flagged as stopped by the guard that are not stopped any more (started by hand, redeployed, failed): the flag no longer applies. */
export function staleShedFlags(candidates: GuardCandidate[]): GuardCandidate[] {
  return candidates.filter((c) => c.shedByGuard && c.status !== "stopped");
}
