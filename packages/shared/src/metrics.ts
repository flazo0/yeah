import { composeProjectName, isValidComposeService } from "./compose";
import { shellQuote } from "./shell";

// Per-container resource usage from `docker stats --no-stream` — read over SSH on demand, no agent.

export interface ContainerStats {
  name: string;
  cpuPercent: number;
  memUsedBytes: number;
  memLimitBytes: number;
  memPercent: number;
  netRxBytes: number;
  netTxBytes: number;
  blockReadBytes: number;
  blockWriteBytes: number;
  pids: number;
}

const UNITS: Record<string, number> = {
  b: 1,
  kb: 1000,
  mb: 1000 ** 2,
  gb: 1000 ** 3,
  tb: 1000 ** 4,
  kib: 1024,
  mib: 1024 ** 2,
  gib: 1024 ** 3,
  tib: 1024 ** 4,
};

/** "3.5MiB" → bytes; unknown or malformed → 0. */
export function parseSize(text: string): number {
  const m = /^\s*([0-9]*\.?[0-9]+)\s*([a-zA-Z]*)\s*$/.exec(text);
  if (!m) return 0;
  const unit = UNITS[(m[2] || "b").toLowerCase()];
  return unit ? Math.round(Number(m[1]) * unit) : 0;
}

const percent = (text: unknown) => {
  const n = parseFloat(String(text ?? "").replace("%", ""));
  return Number.isFinite(n) ? n : 0;
};
const pair = (text: unknown): [number, number] => {
  const [a = "", b = ""] = String(text ?? "").split("/");
  return [parseSize(a), parseSize(b)];
};

/** Parses the output of `docker stats --no-stream --format '{{json .}}'` (one JSON object per line). */
export function parseDockerStats(output: string): ContainerStats[] {
  const stats: ContainerStats[] = [];
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let row: Record<string, unknown>;
    try {
      row = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (typeof row.Name !== "string") continue;
    const [memUsed, memLimit] = pair(row.MemUsage);
    const [rx, tx] = pair(row.NetIO);
    const [read, write] = pair(row.BlockIO);
    stats.push({
      name: row.Name,
      cpuPercent: percent(row.CPUPerc),
      memUsedBytes: memUsed,
      memLimitBytes: memLimit,
      memPercent: percent(row.MemPerc),
      netRxBytes: rx,
      netTxBytes: tx,
      blockReadBytes: read,
      blockWriteBytes: write,
      pids: Number.parseInt(String(row.PIDs ?? "0"), 10) || 0,
    });
  }
  return stats;
}

/** The stats command for an application: its one container, or every container of its compose project. */
export function containerStatsCommand(app: { id: string; buildPack: string }): string {
  const format = "--no-stream --format '{{json .}}'";
  if (app.buildPack === "docker_compose") {
    const filter = `--filter ${shellQuote(`label=com.docker.compose.project=${composeProjectName(app.id)}`)}`;
    return `ids=$(docker ps -q ${filter}); [ -n "$ids" ] || { echo "nenhum container em execução"; exit 1; }; docker stats ${format} $ids`;
  }
  return `docker stats ${format} ${shellQuote(`yeah-app-${app.id}`)}`;
}

void isValidComposeService;
