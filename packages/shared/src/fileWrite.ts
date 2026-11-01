import { shellQuote } from "./shell";
import { MAX_BROWSER_PATH, resolveContainerFragment, type BrowserTarget } from "./fileBrowser";

// Write side of the container file browser: save a text file, upload a file, create a folder, delete.
// Every command is a `docker exec` into the container, so symlinks resolve inside the container's own
// filesystem and cannot reach the host. Paths and the staging file name are shell-quoted arguments,
// never spliced into the script; the builders here are pure and never touch SSH.

/** Largest text file the editor loads and saves. */
export const MAX_EDIT_FILE_BYTES = 2 * 1024 * 1024;
export const DEFAULT_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
const MAX_UPLOAD_MB = 100;

/** Writes are off unless the operator sets FILE_BROWSER_WRITES to `true` or `1`. */
export function fileWritesEnabled(value: string | undefined): boolean {
  const v = (value ?? "").trim().toLowerCase();
  return v === "true" || v === "1";
}

/** Upload cap in bytes from FILE_BROWSER_UPLOAD_MAX_MB (whole megabytes, 1 to 100; default 10). */
export function uploadLimitBytes(value: string | undefined): number {
  const n = Number((value ?? "").trim());
  if (!Number.isInteger(n) || n < 1) return DEFAULT_UPLOAD_MAX_BYTES;
  return Math.min(n, MAX_UPLOAD_MB) * 1024 * 1024;
}

/**
 * Canonical form of a container path: absolute, no control characters, no `.` or `..` segments,
 * repeated slashes collapsed, no trailing slash. Returns null for anything else.
 */
export function normalizeBrowserPath(path: unknown): string | null {
  if (typeof path !== "string" || path.length === 0 || path.length > MAX_BROWSER_PATH || !path.startsWith("/")) return null;
  if (/[\u0000-\u001f\u007f]/.test(path)) return null;
  const segments = path.split("/").filter((s) => s !== "");
  if (segments.some((s) => s === "." || s === ".." || s.length > 255)) return null;
  return "/" + segments.join("/");
}

/** A single file or folder name: no slash, no dot-only names, no control characters. */
export function isValidEntryName(name: unknown): name is string {
  if (typeof name !== "string" || name.length === 0 || name.length > 255) return false;
  if (name === "." || name === ".." || name.includes("/")) return false;
  return !/[\u0000-\u001f\u007f]/.test(name);
}

export type FileWriteOp = "save" | "upload" | "mkdir" | "delete";

const PSEUDO_FS = ["/proc", "/sys", "/dev"];

/**
 * Why a path may not be changed, or null when it may. Kernel pseudo-filesystems, sockets (often the
 * Docker socket mounted from the host) and the root are never writable; deleting also refuses the
 * top-level directories (`/etc`, `/usr`, `/app`...), so only things inside them can be removed.
 * The path must already be canonical (see `normalizeBrowserPath`).
 */
export function writeRefusal(path: string, _op: FileWriteOp): string | null {
  const normalized = normalizeBrowserPath(path);
  if (!normalized || normalized !== path) return "invalid path";
  if (path === "/") return "the root cannot be changed";
  if (PSEUDO_FS.some((p) => path === p || path.startsWith(`${p}/`))) return "this location cannot be changed";
  if (path.toLowerCase().endsWith(".sock")) return "sockets cannot be changed";
  if (_op === "delete" && path.split("/").filter(Boolean).length < 2) return "top-level folders cannot be deleted";
  return null;
}

/** Deleting needs the caller to repeat the exact path as the confirmation. */
export function confirmsDelete(path: string, confirm: unknown): boolean {
  return typeof confirm === "string" && confirm === path;
}

/** Decodes bytes as UTF-8 text for the editor; null when binary (NUL bytes) or not valid UTF-8. */
export function decodeEditableText(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** Host temp file used to stage a write: a fixed prefix plus a lowercase hex/dash id. */
export function isSafeStagingPath(path: string): boolean {
  return /^\/tmp\/yeah-fb-[a-f0-9-]{8,64}$/.test(path);
}

/** Creates the staging file empty and private (0600) before the content is written into it. */
export function prepareStagingCommand(staging: string): string {
  if (!isSafeStagingPath(staging)) throw new Error("unsafe staging path");
  return `umask 077; : > ${shellQuote(staging)}`;
}

/**
 * Streams the staged host file into the container file (`docker exec -i ... cat`), which keeps the
 * owner and mode of an existing file. `onlyNew` refuses to replace an existing entry (exit 5); a
 * directory target exits 4. The staging file is removed whatever happens.
 */
export function writeFileCommand(target: BrowserTarget, path: string, staging: string, opts: { onlyNew?: boolean } = {}): string {
  if (!isSafeStagingPath(staging)) throw new Error("unsafe staging path");
  const guard =
    `if [ -d "$1" ]; then echo "is a directory" >&2; exit 4; fi; ` +
    (opts.onlyNew ? `if [ -e "$1" ]; then echo "already exists" >&2; exit 5; fi; ` : "") +
    `cat > "$1"`;
  return (
    `${resolveContainerFragment(target)}` +
    `docker exec -i "$c" sh -c ${shellQuote(guard)} sh ${shellQuote(path)} < ${shellQuote(staging)} 2>&1; rc=$?; ` +
    `rm -f ${shellQuote(staging)}; exit $rc`
  );
}

export function mkdirCommand(target: BrowserTarget, path: string): string {
  return `${resolveContainerFragment(target)}docker exec "$c" mkdir -- ${shellQuote(path)} 2>&1`;
}

/** Recursive delete of a file or folder; callers must have passed `writeRefusal(path, "delete")`. */
export function deleteCommand(target: BrowserTarget, path: string): string {
  return `${resolveContainerFragment(target)}docker exec "$c" rm -r -- ${shellQuote(path)} 2>&1`;
}
