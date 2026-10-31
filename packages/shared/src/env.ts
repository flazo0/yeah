/**
 * Parsing and expansion of the ".env" text an application carries.
 *
 * Extra syntax on top of plain KEY=value lines:
 *   - `build:KEY=value`  available only while building the image (passed as --build-arg)
 *   - `both:KEY=value`   available while building AND at runtime
 *   - anything else       runtime only (goes into the container's env file), as before
 *   - `{{scope.NAME}}`   in a value: replaced by the shared variable NAME of that scope
 *                         (scope = team | project | environment) at deploy time
 */

export type EnvAvailability = "runtime" | "build" | "both";

export interface EnvEntry {
  key: string;
  value: string;
  availability: EnvAvailability;
}

export type SharedVariableScope = "team" | "project" | "environment";

export const SHARED_VARIABLE_SCOPES: SharedVariableScope[] = ["team", "project", "environment"];

const LINE = /^(?:(build|both):)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

/** Blank lines and `#` comments are skipped; a line that isn't KEY=value is ignored rather than fatal. */
export function parseEnvContent(content: string): EnvEntry[] {
  const entries: EnvEntry[] = [];
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = LINE.exec(line);
    if (!match) continue;
    entries.push({ key: match[2]!, value: match[3]!, availability: (match[1] as EnvAvailability | undefined) ?? "runtime" });
  }
  return entries;
}

/** The contents of the container's env file: runtime + both. */
export function renderRuntimeEnv(entries: EnvEntry[]): string {
  const lines = entries.filter((e) => e.availability !== "build").map((e) => `${e.key}=${e.value}`);
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

/** Entries handed to the build: build + both. */
export function buildTimeEntries(entries: EnvEntry[]): EnvEntry[] {
  return entries.filter((e) => e.availability !== "runtime");
}

export interface SharedVariableValue {
  scope: SharedVariableScope;
  key: string;
  value: string;
}

const REFERENCE = /\{\{\s*(team|project|environment)\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

export interface ExpandResult {
  entries: EnvEntry[];
  /** References that pointed at a variable that doesn't exist, as "scope.NAME". */
  missing: string[];
}

/**
 * Replaces `{{scope.NAME}}` in every value. When the same name exists in several scopes each reference
 * still names its own scope explicitly, so there is no precedence to reason about.
 */
export function expandReferences(entries: EnvEntry[], variables: SharedVariableValue[]): ExpandResult {
  const lookup = new Map(variables.map((v) => [`${v.scope}.${v.key}`, v.value]));
  const missing = new Set<string>();
  const expanded = entries.map((entry) => ({
    ...entry,
    value: entry.value.replace(REFERENCE, (_whole, scope: string, name: string) => {
      const found = lookup.get(`${scope}.${name}`);
      if (found === undefined) {
        missing.add(`${scope}.${name}`);
        return "";
      }
      return found;
    }),
  }));
  return { entries: expanded, missing: [...missing] };
}

export function isValidVariableKey(key: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && key.length <= 255;
}

/** Inverse of parseEnvContent for the table editor: `build:`/`both:` prefixes, runtime has none. */
export function serializeEnvEntries(entries: EnvEntry[]): string {
  const lines = entries.map((e) => `${e.availability === "runtime" ? "" : `${e.availability}:`}${e.key}=${e.value}`);
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}
