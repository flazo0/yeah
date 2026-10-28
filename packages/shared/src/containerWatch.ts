// Spots containers that are crash-looping or getting killed for memory, from one `docker inspect` pass.

/** One line per container: `name|status|exitCode|oomKilled|restartCount|restartPolicy`. */
export function containerWatchCommand(): string {
  return "docker ps -a -q | xargs -r docker inspect --format '{{.Name}}|{{.State.Status}}|{{.State.ExitCode}}|{{.State.OOMKilled}}|{{.RestartCount}}|{{.HostConfig.RestartPolicy.Name}}'";
}

export interface WatchedContainer {
  name: string;
  status: string;
  exitCode: number;
  oomKilled: boolean;
  restartCount: number;
  restartPolicy: string;
}

export function parseContainerWatch(output: string): WatchedContainer[] {
  const rows: WatchedContainer[] = [];
  for (const line of output.split(/\r?\n/)) {
    const p = line.trim().split("|");
    if (p.length < 6 || !p[0]) continue;
    rows.push({ name: p[0].replace(/^\//, ""), status: p[1]!, exitCode: Number(p[2]) || 0, oomKilled: p[3] === "true", restartCount: Number(p[4]) || 0, restartPolicy: p[5]! });
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
      problems.push({ name: c.name, reason: "restarting", detail: `reiniciando sem parar (código de saída ${c.exitCode}, ${c.restartCount} reinícios)` });
    } else if (c.oomKilled && delta >= 1) {
      problems.push({ name: c.name, reason: "oom-killed", detail: "foi encerrado por falta de memória (OOM)" });
    } else if (delta >= 3) {
      problems.push({ name: c.name, reason: "restart-loop", detail: `reiniciou ${delta} vezes desde a última verificação` });
    }
  }
  return problems;
}
