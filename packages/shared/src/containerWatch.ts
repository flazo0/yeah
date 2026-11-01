// Spots containers that are crash-looping or getting killed for memory, from one `docker inspect` pass.

/** One line per container: `name|status|exitCode|oomKilled|restartCount|restartPolicy|health` (health is empty without a HEALTHCHECK). */
export function containerWatchCommand(): string {
  return "docker ps -a -q | xargs -r docker inspect --format '{{.Name}}|{{.State.Status}}|{{.State.ExitCode}}|{{.State.OOMKilled}}|{{.RestartCount}}|{{.HostConfig.RestartPolicy.Name}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}'";
}

export interface WatchedContainer {
  name: string;
  status: string;
  exitCode: number;
  oomKilled: boolean;
  restartCount: number;
  restartPolicy: string;
  /** `healthy`, `unhealthy` or `starting`; empty when the image has no HEALTHCHECK. */
  health: string;
}

export function parseContainerWatch(output: string): WatchedContainer[] {
  const rows: WatchedContainer[] = [];
  for (const line of output.split(/\r?\n/)) {
    const p = line.trim().split("|");
    if (p.length < 6 || !p[0]) continue;
    rows.push({ name: p[0].replace(/^\//, ""), status: p[1]!, exitCode: Number(p[2]) || 0, oomKilled: p[3] === "true", restartCount: Number(p[4]) || 0, restartPolicy: p[5]!, health: p[6] ?? "" });
  }
  return rows;
}

export interface ContainerProblem {
  name: string;
  reason: "restarting" | "restart-loop" | "oom-killed";
  detail: string;
}

/**
 * `previous` maps a container name to the restart count seen on the last pass (the first pass only learns
 * the counts, it never alerts on history). Containers in `ignore` are skipped (apps put to sleep on purpose).
 */
export function detectContainerProblems(previous: Map<string, number>, rows: WatchedContainer[], ignore: Set<string> = new Set()): ContainerProblem[] {
  const problems: ContainerProblem[] = [];
  for (const c of rows) {
    const before = previous.get(c.name);
    previous.set(c.name, c.restartCount);
    if (ignore.has(c.name) || before === undefined) continue;
    const delta = c.restartCount - before;
    if (c.status === "restarting") {
      problems.push({ name: c.name, reason: "restarting", detail: `restarting in a loop (exit code ${c.exitCode}, ${c.restartCount} restarts)` });
    } else if (c.oomKilled && delta >= 1) {
      problems.push({ name: c.name, reason: "oom-killed", detail: "was killed for running out of memory (OOM)" });
    } else if (delta >= 3) {
      problems.push({ name: c.name, reason: "restart-loop", detail: `restarted ${delta} times since the last check` });
    }
  }
  return problems;
}

/** Containers whose status changes are reported: the ones yeah creates (applications, databases, services and their Compose stacks). */
export function isManagedContainerName(name: string): boolean {
  return /^yeah-(app|db|svc)-/.test(name);
}

/** The state a container is reported in: a failing healthcheck outranks the Docker status of a still-running container. */
export function effectiveContainerState(c: Pick<WatchedContainer, "status" | "health">): string {
  return c.status === "running" && c.health === "unhealthy" ? "unhealthy" : c.status;
}

export interface ContainerStatusChange {
  name: string;
  from: string;
  to: string;
}

interface TrackedState {
  reported: string;
  candidate: string | null;
  candidatePolls: number;
  lastReportedAt: number;
}

/**
 * Turns a stream of polls into status-change notifications without flooding on a flapping container:
 * - the first poll only learns the state (no alert on history);
 * - a new state must be seen on `confirmPolls` consecutive polls before it is reported (a blip that goes
 *   back to the reported state is never reported);
 * - after a report, the same container is held for `minIntervalMs` before the next one, so a container
 *   that keeps flapping produces at most one message per interval, always describing the latest settled state.
 * Containers that disappear are forgotten (a removed container is not a status change).
 */
export class ContainerStatusTracker {
  private states = new Map<string, TrackedState>();

  constructor(
    private readonly confirmPolls = 2,
    private readonly minIntervalMs = 5 * 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  observe(rows: WatchedContainer[], ignore: Set<string> = new Set()): ContainerStatusChange[] {
    const t = this.now();
    const changes: ContainerStatusChange[] = [];
    const seen = new Set<string>();
    for (const c of rows) {
      if (!isManagedContainerName(c.name) || ignore.has(c.name)) continue;
      seen.add(c.name);
      const state = effectiveContainerState(c);
      const tracked = this.states.get(c.name);
      if (!tracked) {
        this.states.set(c.name, { reported: state, candidate: null, candidatePolls: 0, lastReportedAt: Number.NEGATIVE_INFINITY });
        continue;
      }
      if (state === tracked.reported) {
        tracked.candidate = null;
        tracked.candidatePolls = 0;
        continue;
      }
      if (state === tracked.candidate) tracked.candidatePolls++;
      else {
        tracked.candidate = state;
        tracked.candidatePolls = 1;
      }
      if (tracked.candidatePolls < this.confirmPolls || t - tracked.lastReportedAt < this.minIntervalMs) continue;
      changes.push({ name: c.name, from: tracked.reported, to: state });
      tracked.reported = state;
      tracked.candidate = null;
      tracked.candidatePolls = 0;
      tracked.lastReportedAt = t;
    }
    for (const name of [...this.states.keys()]) if (!seen.has(name)) this.states.delete(name);
    return changes;
  }
}
