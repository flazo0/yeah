// Capacity planning for a server: how much memory is already promised to resources through their limits,
// and what is left. Pure, so the numbers shown in the panel can be tested.

/** Memory kept for the operating system, Docker, the proxy and (on a single-server install) the panel itself. */
export const SYSTEM_RESERVE_MB = 768;

export interface CapacityResource {
  memoryLimitMb: number | null;
}

export interface CapacitySummary {
  memTotalMb: number;
  /** What projects can use after the system reserve. */
  availableMb: number;
  /** Sum of the memory limits that are set. */
  committedMb: number;
  resourceCount: number;
  /** Resources with no memory limit: each can grow until the server runs out. */
  unlimitedCount: number;
  /** committedMb / availableMb. Above 1 the limits add up to more memory than the server has. */
  commitRatio: number;
  /** Memory per resource if the available memory were split evenly. */
  evenShareMb: number;
  status: "ok" | "tight" | "over";
}

export function summarizeCapacity(memTotalMb: number, resources: CapacityResource[], reserveMb = SYSTEM_RESERVE_MB): CapacitySummary {
  const availableMb = Math.max(0, memTotalMb - reserveMb);
  let committedMb = 0;
  let unlimitedCount = 0;
  for (const r of resources) {
    if (r.memoryLimitMb && r.memoryLimitMb > 0) committedMb += r.memoryLimitMb;
    else unlimitedCount++;
  }
  const commitRatio = availableMb > 0 ? committedMb / availableMb : committedMb > 0 ? Infinity : 0;
  const evenShareMb = resources.length > 0 ? Math.floor(availableMb / resources.length) : availableMb;
  // Limits are ceilings, not reservations, so going over 100% is allowed (most apps idle far below their limit);
  // it is flagged because a burst by several of them at once is what makes a server swap or kill processes.
  const status = commitRatio > 1.5 ? "over" : commitRatio > 1 || (unlimitedCount > 0 && resources.length > 0 && commitRatio > 0.7) ? "tight" : "ok";
  return { memTotalMb, availableMb, committedMb, resourceCount: resources.length, unlimitedCount, commitRatio, evenShareMb, status };
}
