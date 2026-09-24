/** Quotes a value for safe interpolation into a POSIX shell command (single-quote style). */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

const RESERVED_DOCKER_FLAGS = ["--name", "-d", "--detach", "--rm", "--env-file", "--restart"];

export type DockerOptionsResult = { ok: true; args: string[] } | { ok: false; error: string };

/**
 * Splits a free-text "extra docker run options" field into arguments, the way a shell would tokenize
 * quotes (single, double, backslash escapes) but without ever running one: each resulting word is
 * shell-quoted by the caller, so `$(...)`, `;` and friends are just literal text. Flags the deploy
 * manages itself are rejected.
 */
export function parseDockerOptions(input: string): DockerOptionsResult {
  const args: string[] = [];
  let current = "";
  let inWord = false;
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (quote === "'") {
      if (ch === "'") quote = null;
      else current += ch;
    } else if (quote === '"') {
      if (ch === '"') quote = null;
      else if (ch === "\\" && i + 1 < input.length && /["\$`]/.test(input[i + 1]!)) current += input[++i];
      else current += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      inWord = true;
    } else if (ch === "\\" && i + 1 < input.length) {
      current += input[++i];
      inWord = true;
    } else if (/\s/.test(ch)) {
      if (inWord) {
        args.push(current);
        current = "";
        inWord = false;
      }
    } else {
      current += ch;
      inWord = true;
    }
  }
  if (quote) return { ok: false, error: "aspas sem fechar nas opções do docker" };
  if (inWord) args.push(current);

  for (const arg of args) {
    const flag = arg.split("=")[0]!;
    if (RESERVED_DOCKER_FLAGS.includes(flag)) {
      return { ok: false, error: `a opção ${flag} é controlada pelo yeah e não pode ser sobrescrita aqui` };
    }
  }
  return { ok: true, args };
}

/** Lowercase, dash-separated form of a resource name — the subdomain the wildcard domain gives it. */
export function resourceSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** A publish directory is a plain relative path inside the repo: no absolute paths, no "..", no quoting tricks. */
export function isSafePublishDirectory(dir: string): boolean {
  if (dir === "." || dir === "") return true;
  if (dir.startsWith("/") || dir.includes("\\") || /["'`$;&|<>\s]/.test(dir)) return false;
  return !dir.split("/").includes("..");
}

/** A registry image reference ("nginx", "ghcr.io/org/app:1.2", "app@sha256:...") — no spaces or shell characters. */
export function isValidDockerImage(image: string): boolean {
  if (image.length === 0 || image.length > 512) return false;
  const digest = image.match(/@sha256:[a-f0-9]{64}$/);
  const ref = digest ? image.slice(0, digest.index) : image;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/:-]*$/.test(ref)) return false;
  // A registry host may carry a port ("host:5000/team/app"), but only the last path segment can hold the tag.
  const lastSegment = ref.split("/").pop() ?? "";
  return (lastSegment.match(/:/g) ?? []).length <= 1 && !lastSegment.endsWith(":") && !ref.includes("//");
}

/** Git URLs that authenticate with an SSH key: scp-like ("git@host:org/repo.git") or ssh://. */
export function isSshGitUrl(url: string): boolean {
  return /^(git@[\w.-]+:[^\s]+|ssh:\/\/[^\s]+)$/.test(url);
}

/** A host directory for a bind mount: absolute, no "..", no quoting/shell characters. */
export function isSafeHostPath(path: string): boolean {
  if (!path.startsWith("/") || path === "/" || path.length > 512) return false;
  if (/["'`$;&|<>\s\\]/.test(path) || /[\x00-\x1f]/.test(path)) return false;
  return !path.split("/").includes("..");
}

/** A path inside the container: absolute and free of quoting characters. */
export function isSafeMountPath(path: string): boolean {
  return path.startsWith("/") && path.length <= 512 && !/["'`$;&|<>\\]/.test(path) && !/[\x00-\x1f]/.test(path);
}
