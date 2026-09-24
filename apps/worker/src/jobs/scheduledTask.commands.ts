import { shellQuote } from "@yeah/shared";

/** Runs the user's command through `sh -c` inside the application's container. */
export function buildTaskCommand(containerName: string, command: string): string {
  return `docker exec ${shellQuote(containerName)} sh -c ${shellQuote(command)}`;
}

export const MAX_TASK_LOG_BYTES = 200_000;
export const KEEP_EXECUTIONS = 50;

/** Appends `chunk` to a log kept under `max` bytes; once full, further output is dropped and a marker added once. */
export function appendCapped(current: string, chunk: string, max = MAX_TASK_LOG_BYTES): string {
  if (current.length >= max) return current;
  const room = max - current.length;
  if (chunk.length <= room) return current + chunk;
  return current + chunk.slice(0, room) + "\n[saída truncada]\n";
}
