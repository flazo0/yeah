import { shellQuote } from "./shell";

// Configuration files that ship with a service template (an nginx.conf, an init script, a Kong config…):
// written next to the compose file before the stack starts, and bind-mounted by it with `./path:/target`.

export interface StackFiles {
  /** Relative path (inside the stack directory) → file content. */
  files: Record<string, string>;
  /** Relative directories that must exist before the stack starts (bind-mounted empty folders). */
  dirs: string[];
}

export const MAX_STACK_FILES = 100;
export const MAX_STACK_FILE_BYTES = 512 * 1024;

/** A relative path of plain characters with no `.`/`..` segments — it can never leave the stack directory. */
export function isSafeStackPath(path: string): boolean {
  if (path.length === 0 || path.length > 200 || path.startsWith("/")) return false;
  if (!/^[A-Za-z0-9._\-/]+$/.test(path)) return false;
  return path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

export function validateStackFiles(stack: StackFiles): string | null {
  const paths = Object.keys(stack.files);
  if (paths.length > MAX_STACK_FILES) return `no máximo ${MAX_STACK_FILES} arquivos`;
  for (const p of [...paths, ...stack.dirs]) if (!isSafeStackPath(p)) return `caminho de arquivo inválido: ${p}`;
  for (const [p, content] of Object.entries(stack.files)) {
    if (Buffer.byteLength(content, "utf8") > MAX_STACK_FILE_BYTES) return `o arquivo ${p} passa de ${MAX_STACK_FILE_BYTES / 1024} KB`;
  }
  return null;
}

/**
 * Substitutes `${NAME}`, `${NAME:-default}` and `${NAME-default}` with values from the service's environment.
 * Names that are not in the environment — and every other `$` (shell variables, `$$` dollar quoting in SQL) —
 * are left exactly as written, so scripts keep working.
 */
export function renderStackFile(content: string, env: Record<string, string>): string {
  return content.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::?-([^}]*))?\}/g, (whole, name: string, fallback: string | undefined) => {
    const value = env[name];
    if (value !== undefined && value !== "") return value;
    if (fallback !== undefined) return fallback;
    return value !== undefined ? value : whole;
  });
}

export interface StackFileWrite {
  path: string;
  content: string;
  executable: boolean;
}

/** Files to write (already rendered); scripts (shebang) are marked executable. Sorted for stable output. */
export function stackFileWrites(stack: StackFiles, env: Record<string, string>): StackFileWrite[] {
  return Object.keys(stack.files)
    .sort()
    .map((path) => {
      const content = renderStackFile(stack.files[path]!, env);
      return { path, content, executable: content.startsWith("#!") };
    });
}

/** `mkdir -p` for every directory the files and the empty bind-mount folders need, relative to `base`. */
export function stackDirsCommand(base: string, stack: StackFiles): string {
  const dirs = new Set<string>(stack.dirs);
  for (const path of Object.keys(stack.files)) {
    const idx = path.lastIndexOf("/");
    if (idx > 0) dirs.add(path.slice(0, idx));
  }
  if (dirs.size === 0) return "true";
  return `mkdir -p ${[...dirs].sort().map((d) => shellQuote(`${base}/${d}`)).join(" ")}`;
}
