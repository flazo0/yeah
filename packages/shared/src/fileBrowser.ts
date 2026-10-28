import { composeProjectName, isValidComposeService } from "./compose";
import { shellQuote } from "./shell";

// Read-only file browser for a running application's container: list a directory, read a text file.
// Everything is `docker exec` with the path passed as an argument (never spliced into a shell string).

export const MAX_BROWSER_PATH = 1024;
/** Largest file the browser will fetch; bigger ones are cut and flagged. */
export const MAX_BROWSER_FILE_BYTES = 256 * 1024;

export interface BrowserEntry {
  name: string;
  kind: "dir" | "file" | "link" | "other";
  size: number | null;
  mode: string;
}

/** An absolute path with no control characters and no `..` segments, short enough to be sane. */
export function isSafeBrowserPath(path: string): boolean {
  if (path.length === 0 || path.length > MAX_BROWSER_PATH || !path.startsWith("/")) return false;
  if (/[\u0000-\u001f\u007f]/.test(path)) return false;
  return !path.split("/").includes("..");
}

/** Shell fragment that sets `$c` to the container to look into (the first container of a compose project/service). */
function resolveContainer(app: { id: string; buildPack: string; composeService: string | null }): string {
  if (app.buildPack === "docker_compose") {
    const service = app.composeService && isValidComposeService(app.composeService) ? app.composeService : null;
    const filters =
      `--filter ${shellQuote(`label=com.docker.compose.project=${composeProjectName(app.id)}`)}` +
      (service ? ` --filter ${shellQuote(`label=com.docker.compose.service=${service}`)}` : "");
    return `c=$(docker ps -q ${filters} | head -n 1); [ -n "$c" ] || { echo "nenhum container em execução"; exit 3; }; `;
  }
  return `c=${shellQuote(`yeah-app-${app.id}`)}; `;
}

type BrowserApp = { id: string; buildPack: string; composeService: string | null };

/** `ls -lAp` works the same on GNU and BusyBox (alpine); the date is always three words. */
export function listDirCommand(app: BrowserApp, path: string): string {
  return `${resolveContainer(app)}docker exec "$c" ls -lAp -- ${shellQuote(path)} 2>&1`;
}

export function readFileCommand(app: BrowserApp, path: string): string {
  return `${resolveContainer(app)}docker exec "$c" head -c ${MAX_BROWSER_FILE_BYTES + 1} -- ${shellQuote(path)} 2>&1`;
}

/** Parses `ls -lAp` output; lines that are not entries (the "total" line, errors) are ignored. */
export function parseListing(output: string): BrowserEntry[] {
  const entries: BrowserEntry[] = [];
  for (const line of output.split(/\r?\n/)) {
    const tokens = line.trim().split(/\s+/);
    // perms links owner group size month day time name… (symlinks end with `name -> target`)
    if (tokens.length < 9 || !/^[-dlbcps][-rwxsStT]{9}[.+@]?$/.test(tokens[0]!)) continue;
    const mode = tokens[0]!;
    let name = tokens.slice(8).join(" ");
    // Re-derive the name from the original line so names with several spaces survive.
    const idx = nthTokenEnd(line, 8);
    if (idx !== -1) name = line.slice(idx).trim();
    const arrow = name.indexOf(" -> ");
    if (mode.startsWith("l") && arrow !== -1) name = name.slice(0, arrow);
    const isDir = mode.startsWith("d");
    if (name.endsWith("/")) name = name.slice(0, -1);
    if (!name || name === "." || name === "..") continue;
    const size = Number(tokens[4]);
    entries.push({ name, kind: isDir ? "dir" : mode.startsWith("l") ? "link" : mode.startsWith("-") ? "file" : "other", size: Number.isFinite(size) && !isDir ? size : null, mode });
  }
  return entries.sort((a, b) => (a.kind === "dir" ? 0 : 1) - (b.kind === "dir" ? 0 : 1) || a.name.localeCompare(b.name));
}

/** Index in `line` right after the n-th whitespace-separated token (counting from 1), or -1. */
function nthTokenEnd(line: string, n: number): number {
  let count = 0;
  let i = 0;
  while (i < line.length) {
    while (i < line.length && /\s/.test(line[i]!)) i++;
    if (i >= line.length) break;
    while (i < line.length && !/\s/.test(line[i]!)) i++;
    count++;
    if (count === n) return i;
  }
  return -1;
}

/** Joins a directory and a child name into a path (no duplicate slash). */
export function joinBrowserPath(dir: string, name: string): string {
  return dir === "/" ? `/${name}` : `${dir.replace(/\/+$/, "")}/${name}`;
}

export function parentBrowserPath(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx <= 0 ? "/" : trimmed.slice(0, idx);
}

/** Whether fetched bytes look like text (no NUL bytes in what we got). */
export function looksLikeText(content: string): boolean {
  return !content.includes("\u0000");
}
