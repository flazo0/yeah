import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseComposeStack, type ServiceTemplateDto } from "@yeah/shared";

// One-click service templates: YAML files in packages/templates/services (a compose file plus metadata),
// read from disk — adding a service is adding a file, no code.

export interface ServiceTemplate extends ServiceTemplateDto {
  /** Compose text with ${VAR} placeholders. */
  compose: string;
  /** Initial variables; values like "$generate:password" become a fresh secret per instance. */
  env: Record<string, string>;
  /** Port of `main` the domain is proxied to. */
  port: number;
}

/** packages/templates/services relative to this file — the same place in dev and in the image. */
export const TEMPLATES_DIR = process.env.TEMPLATES_DIR ?? resolve(import.meta.dir, "../../../../packages/templates/services");

const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

function parseYaml(text: string): unknown {
  return (Bun as unknown as { YAML: { parse(t: string): unknown } }).YAML.parse(text);
}

/** Builds a template from a file's text, or explains what is wrong with it. */
export function parseTemplate(key: string, text: string): { template: ServiceTemplate } | { error: string } {
  let doc: Record<string, unknown>;
  try {
    doc = parseYaml(text) as Record<string, unknown>;
  } catch (err) {
    return { error: `YAML inválido: ${err instanceof Error ? err.message : "erro"}` };
  }
  if (!doc || typeof doc !== "object") return { error: "o template precisa ser um objeto" };
  const str = (k: string) => (typeof doc[k] === "string" && (doc[k] as string).trim() ? (doc[k] as string) : null);
  const name = str("name");
  const description = str("description");
  const compose = str("compose");
  const main = str("main");
  if (!name || !description || !compose || !main) return { error: "faltam campos obrigatórios (name, description, compose, main)" };
  const stack = parseComposeStack(compose);
  if (!stack.ok) return { error: stack.error };
  const services = Object.keys(stack.services);
  if (!services.includes(main)) return { error: `main "${main}" não é um serviço do compose` };
  const port = Number(doc.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { error: "port inválida" };
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries((doc.env as Record<string, unknown>) ?? {})) {
    if (!ENV_KEY.test(k)) return { error: `nome de variável inválido: ${k}` };
    env[k] = String(v ?? "");
  }
  return {
    template: {
      key,
      name,
      description,
      icon: str("icon") ?? "widgets",
      category: str("category") ?? "other",
      website: str("website") ?? undefined,
      docsUrl: str("docs") ?? undefined,
      notes: str("notes") ?? undefined,
      mainService: main,
      services,
      compose,
      env,
      port,
    },
  };
}

let cache: ServiceTemplate[] | null = null;

/** Every valid template, cached; invalid files are reported once and skipped. */
export function loadTemplates(dir = TEMPLATES_DIR): ServiceTemplate[] {
  if (cache && dir === TEMPLATES_DIR) return cache;
  const out: ServiceTemplate[] = [];
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".yml"));
  } catch {
    console.error(`[api] templates: cannot read ${dir}`);
  }
  for (const file of files.sort()) {
    const key = file.replace(/\.yml$/, "");
    const parsed = parseTemplate(key, readFileSync(join(dir, file), "utf8"));
    if ("error" in parsed) console.error(`[api] templates: ${file} ignorado — ${parsed.error}`);
    else out.push(parsed.template);
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  if (dir === TEMPLATES_DIR) cache = out;
  return out;
}

export function findTemplate(key: string): ServiceTemplate | undefined {
  return loadTemplates().find((t) => t.key === key);
}

/** The "$generate:<kind>" markers: password (24 hex chars), hex (64), base64 (32 random bytes, url-safe). */
export function generateSecret(kind: string, bytes: (n: number) => Buffer = randomBytes): string | null {
  switch (kind) {
    case "password":
      return bytes(12).toString("hex");
    case "hex":
      return bytes(32).toString("hex");
    case "base64":
      return bytes(32).toString("base64url");
    default:
      return null;
  }
}

/** The .env text for a new instance: defaults as written, generate-markers replaced by fresh secrets. */
export function renderTemplateEnv(template: ServiceTemplate, bytes?: (n: number) => Buffer): string {
  const lines = Object.entries(template.env).map(([k, v]) => {
    const m = /^\$generate:(\w+)$/.exec(v);
    const secret = m ? generateSecret(m[1]!, bytes) : null;
    return `${k}=${secret ?? v}`;
  });
  return lines.length ? `${lines.join("\n")}\n` : "";
}

export function toTemplateDto(t: ServiceTemplate): ServiceTemplateDto {
  const { compose: _c, env: _e, port: _p, ...dto } = t;
  void [_c, _e, _p];
  return dto;
}
