import { composeProjectName, isValidComposeService } from "./compose";
import { shellQuote } from "./shell";

// Interactive terminal protocol (browser <-> API WebSocket) and the remote commands behind it.

/** Messages the browser sends. Output goes back as raw text frames (it is the PTY's byte stream). */
export type TerminalClientMessage = { type: "input"; data: string } | { type: "resize"; cols: number; rows: number };

export const MIN_TERMINAL_DIM = 2;
export const MAX_TERMINAL_DIM = 500;

/** Parses and bounds-checks a frame from the browser; null for anything that is not a valid message. */
export function parseTerminalMessage(raw: unknown): TerminalClientMessage | null {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  const msg = value as Record<string, unknown>;
  if (msg.type === "input" && typeof msg.data === "string" && msg.data.length <= 65_536) return { type: "input", data: msg.data };
  if (msg.type === "resize") {
    const cols = Math.floor(Number(msg.cols));
    const rows = Math.floor(Number(msg.rows));
    if (Number.isFinite(cols) && Number.isFinite(rows) && cols >= MIN_TERMINAL_DIM && rows >= MIN_TERMINAL_DIM && cols <= MAX_TERMINAL_DIM && rows <= MAX_TERMINAL_DIM) {
      return { type: "resize", cols, rows };
    }
  }
  return null;
}

/** Best shell available in the container: bash when present, else sh. */
const CONTAINER_SHELL = "command -v bash >/dev/null 2>&1 && exec bash || exec sh";

/**
 * `docker exec -it` into the application's container. A compose application has several containers,
 * so it enters the first one of the chosen service (or of the project when none is chosen).
 */
export function containerTerminalCommand(app: { id: string; buildPack: string; composeService: string | null }): string {
  if (app.buildPack === "docker_compose") {
    const project = composeProjectName(app.id);
    const service = app.composeService && isValidComposeService(app.composeService) ? app.composeService : null;
    const filters =
      `--filter ${shellQuote(`label=com.docker.compose.project=${project}`)}` +
      (service ? ` --filter ${shellQuote(`label=com.docker.compose.service=${service}`)}` : "");
    return (
      `c=$(docker ps -q ${filters} | head -n 1); ` +
      `[ -n "$c" ] || { echo "nenhum container em execução — faça um deploy primeiro"; exit 1; }; ` +
      `exec docker exec -it "$c" sh -c ${shellQuote(CONTAINER_SHELL)}`
    );
  }
  return `exec docker exec -it ${shellQuote(`yeah-app-${app.id}`)} sh -c ${shellQuote(CONTAINER_SHELL)}`;
}
