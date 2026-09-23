/**
 * Pre-flight check before queueing work on a server: metrics already tell us when a box is out of
 * disk/RAM, so refusing (or asking the user to confirm) up front beats a build that dies halfway.
 * Pure on purpose — the DB lookup lives in the routes.
 */

export const DISK_BLOCK_PERCENT = 95;
export const MEM_BLOCK_PERCENT = 95;
/** Older snapshots say nothing about right now (server may have been cleaned up since). */
export const METRICS_FRESH_MS = 10 * 60_000;

export interface ServerLoadSnapshot {
  name: string;
  memPercent: number | null;
  diskPercent: number | null;
  metricsCheckedAt: Date | null;
}

export function overloadReason(server: ServerLoadSnapshot, now = Date.now()): string | null {
  if (!server.metricsCheckedAt || now - server.metricsCheckedAt.getTime() > METRICS_FRESH_MS) return null;
  const problems: string[] = [];
  if (server.diskPercent !== null && server.diskPercent >= DISK_BLOCK_PERCENT) {
    problems.push(`disco em ${Math.round(server.diskPercent)}%`);
  }
  if (server.memPercent !== null && server.memPercent >= MEM_BLOCK_PERCENT) {
    problems.push(`memória em ${Math.round(server.memPercent)}%`);
  }
  if (problems.length === 0) return null;
  return `O servidor "${server.name}" está com ${problems.join(" e ")} — o build/provisionamento provavelmente vai falhar. Libere espaço/memória antes, ou confirme pra tentar mesmo assim.`;
}
