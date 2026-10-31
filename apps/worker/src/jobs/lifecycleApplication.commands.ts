import type { ApplicationLifecycleAction } from "@yeah/shared";
import { shellQuote } from "@yeah/shared";

/** The docker command for start/stop/restart of an app's container; stop/restart honor the grace period. */
export function buildLifecycleCommand(action: ApplicationLifecycleAction, containerName: string, graceSeconds: number): string {
  const name = shellQuote(containerName);
  const grace = Math.max(0, Math.floor(graceSeconds));
  if (action === "start") return `docker start ${name}`;
  if (action === "stop") return `docker stop -t ${grace} ${name}`;
  return `docker restart -t ${grace} ${name}`;
}

/** Status the application ends up in when the command succeeds. */
export function lifecycleResultStatus(action: ApplicationLifecycleAction): "running" | "stopped" {
  return action === "stop" ? "stopped" : "running";
}
