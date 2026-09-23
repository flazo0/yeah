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
