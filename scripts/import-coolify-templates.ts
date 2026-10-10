#!/usr/bin/env bun
/**
 * Converts Coolify's one-click service templates (Apache-2.0, coolify/templates/compose/*.yaml in the
 * gitignored reference checkout) into yeah's template format (packages/templates/services/*.yml) and
 * copies their logos. Re-runnable: templates that already exist as hand-written yeah files are kept.
 *
 *   bun run scripts/import-coolify-templates.ts [--dry]
 *
 * What changes in the compose text:
 *  - `SERVICE_URL_X` / `SERVICE_FQDN_X[_PORT]` *declarations* (Coolify's "give this service a domain")
 *    are dropped; the first one that names a real service decides `main` and `port`.
 *  - `SERVICE_PASSWORD_*`, `SERVICE_USER_*`, `SERVICE_BASE64_*`, `SERVICE_REALBASE64_*` references become
 *    `env:` entries with `$generate:` markers, so each instance gets its own secrets.
 *  - `SERVICE_URL_*` / `SERVICE_FQDN_*` references become env entries that the panel rewrites when a
 *    domain is saved for that container (see apps/api/src/lib/serviceDomainEnv.ts).
 *  - Coolify-only keys (`exclude_from_hc`) are removed. Templates that need Coolify features yeah has no
 *    equivalent for (file `content:` mounts, `build:`, `extends`) are skipped and listed.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const SRC = join(ROOT, "coolify/templates/compose");
const LOGOS_SRC = join(ROOT, "coolify/public");
const OUT = join(ROOT, "packages/templates/services");
const LOGOS_OUT = join(ROOT, "apps/web/public/template-logos");
const DRY = process.argv.includes("--dry");

const CATEGORY_MAP: Record<string, string> = {
  productivity: "productivity", helpdesk: "productivity", documentation: "productivity", family: "productivity", health: "productivity",
  devtools: "dev", development: "dev", "developer-tools": "dev", git: "dev", ci: "dev", mcp: "dev",
  media: "media", rss: "media", games: "games",
  cms: "cms", ai: "ai", storage: "storage", monitoring: "monitoring", automation: "automation",
  backend: "backend", api: "backend", analytics: "analytics",
  messaging: "messaging", communication: "messaging", email: "messaging", mail: "messaging",
  auth: "security", security: "security", vpn: "security",
  database: "database", databases: "database", finance: "finance", search: "search",
  proxy: "devops", networking: "devops",
};
const CATEGORY_ICON: Record<string, string> = {
  productivity: "task_alt", dev: "code", media: "movie", games: "sports_esports", cms: "language", ai: "psychology", storage: "folder",
  monitoring: "monitor_heart", automation: "bolt", backend: "dns", analytics: "analytics", messaging: "forum", security: "shield",
  database: "database", finance: "payments", search: "search", devops: "terminal", other: "widgets",
};
const BRAND: Record<string, string> = {
  n8n: "n8n", wordpress: "WordPress", "uptime-kuma": "Uptime Kuma", nextcloud: "Nextcloud", gitea: "Gitea", grafana: "Grafana", ghost: "Ghost",
  minio: "MinIO", pocketbase: "PocketBase", nocodb: "NocoDB", wikijs: "Wiki.js", "code-server": "code-server", vaultwarden: "Vaultwarden", pgadmin: "pgAdmin",
  rabbitmq: "RabbitMQ", searxng: "SearXNG", "it-tools": "IT Tools", mongodb: "MongoDB", postgresql: "PostgreSQL", mysql: "MySQL", mariadb: "MariaDB",
  clickhouse: "ClickHouse", redis: "Redis", keydb: "KeyDB", openwebui: "Open WebUI", "open-webui": "Open WebUI", appwrite: "Appwrite", supabase: "Supabase",
  nginx: "Nginx", mattermost: "Mattermost", metabase: "Metabase", umami: "Umami", plausible: "Plausible", posthog: "PostHog", directus: "Directus",
  strapi: "Strapi", "home-assistant": "Home Assistant", jellyfin: "Jellyfin", plex: "Plex", immich: "Immich", paperless: "Paperless-ngx", "paperless-ngx": "Paperless-ngx",
  gitlab: "GitLab", penpot: "Penpot", authentik: "authentik", keycloak: "Keycloak", "docker-registry": "Docker Registry", ollama: "Ollama", langfuse: "Langfuse",
};

const key2name = (key: string) => BRAND[key] ?? key.split("-").map((w) => (w.length <= 2 ? w.toUpperCase() : w[0]!.toUpperCase() + w.slice(1))).join(" ");
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_");

interface Result {
  key: string;
  yaml?: string;
  logo?: string;
  skip?: string;
}

function header(text: string, name: string): string | null {
  const m = new RegExp(`^#\\s*${name}:\\s*(.*)$`, "mi").exec(text);
  return m ? m[1]!.trim() : null;
}

function convert(key: string, raw: string): Result {
  const text = raw.replace(/\r\n/g, "\n");
  if (/^\s+content:/m.test(text)) return { key, skip: "usa montagem de arquivo com `content:` (recurso próprio do Coolify)" };
  if (/^\s+is_directory:/m.test(text)) return { key, skip: "usa `is_directory` (recurso próprio do Coolify)" };
  if (/^\s+build:/m.test(text)) return { key, skip: "usa `build:` (aqui só vale image)" };
  if (/^\s+extends:/m.test(text)) return { key, skip: "usa `extends`" };

  let doc: { services?: Record<string, Record<string, unknown>> };
  try {
    doc = (Bun as unknown as { YAML: { parse(t: string): unknown } }).YAML.parse(text) as typeof doc;
  } catch (err) {
    return { key, skip: `YAML inválido (${err instanceof Error ? err.message : "erro"})` };
  }
  const services = doc?.services ?? {};
  const serviceNames = Object.keys(services);
  if (serviceNames.length === 0) return { key, skip: "sem serviços" };
  for (const [name, def] of Object.entries(services)) {
    if (typeof def?.image !== "string") return { key, skip: `o serviço ${name} não tem image` };
  }
  const byNorm = new Map(serviceNames.map((n) => [norm(n), n]));

  // 1) declarations -> main/port, then drop them
  let main: string | null = null;
  let port: number | null = null;
  const lines = text.split("\n");
  const kept: string[] = [];
  const DECL = /^\s*-\s*['"]?SERVICE_(?:URL|FQDN)_([A-Z0-9_]+?)(?:_(\d+))?(?:=[^'"]*)?['"]?\s*$/;
  for (const line of lines) {
    const m = DECL.exec(line);
    if (m) {
      const svc = byNorm.get(norm(m[1]!));
      if (svc && !main) {
        main = svc;
        if (m[2]) port = Number(m[2]);
      }
      continue;
    }
    if (/^\s*exclude_from_hc:\s*(true|false)\s*$/.test(line)) continue;
    kept.push(line);
  }
  // `environment:` / `labels:` left with no entries (they only held the dropped declarations) is invalid compose: drop the key.
  for (let i = kept.length - 1; i >= 0; i--) {
    const m = /^(\s*)(environment|labels):\s*$/.exec(kept[i]!);
    if (!m) continue;
    let j = i + 1;
    while (j < kept.length && kept[j]!.trim() === "") j++;
    const nextIndent = j < kept.length ? /^(\s*)/.exec(kept[j]!)![1]!.length : -1;
    // YAML allows the "- item" lines at the same indent as their key, so a dash right below still counts as content.
    const nextIsItem = j < kept.length && nextIndent === m[1]!.length && kept[j]!.trimStart().startsWith("- ");
    if (nextIndent <= m[1]!.length && !nextIsItem) kept.splice(i, 1);
  }
  // strip the leading comment header (metadata lives in the yeah fields)
  while (kept.length && (kept[0]!.startsWith("#") || kept[0]!.trim() === "")) kept.shift();
  let compose = kept.join("\n").trimEnd() + "\n";

  // Coolify declares named volumes implicitly; plain compose needs a top-level `volumes:` entry for each.
  const declared = new Set(Object.keys((doc as { volumes?: Record<string, unknown> }).volumes ?? {}));
  const missingVolumes = new Set<string>();
  for (const def of Object.values(services)) {
    const vols = Array.isArray(def.volumes) ? (def.volumes as unknown[]) : [];
    for (const v of vols) {
      const src =
        typeof v === "string"
          ? v.split(":")[0]!
          : typeof v === "object" && v !== null && (v as { type?: string }).type === "volume"
            ? String((v as { source?: string }).source ?? "")
            : "";
      if (src && /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(src) && !declared.has(src)) missingVolumes.add(src);
    }
  }
  if (missingVolumes.size > 0) {
    const entries = [...missingVolumes].map((n) => `  ${n}: {}`).join("\n");
    if (/^volumes:\s*\{\}\s*$/m.test(compose)) compose = compose.replace(/^volumes:\s*\{\}\s*$/m, `volumes:\n${entries}`);
    else if (/^volumes:\s*$/m.test(compose)) compose = compose.replace(/^volumes:\s*$/m, `volumes:\n${entries}`);
    else compose = `${compose.trimEnd()}\n\nvolumes:\n${entries}\n`;
  }

  const headerPort = Number(header(text, "port"));
  if (!port && Number.isInteger(headerPort) && headerPort > 0) port = headerPort;
  if (!main) main = serviceNames[0]!;
  if (!port) port = 80;

  // 2) env entries from magic variables and bare ${VAR}s
  const env: Record<string, string> = {};
  // `$${VAR}` is compose's escape for a literal ${VAR} (used inside healthchecks), so a preceding `$` means "not ours".
  const REF = /(?<!\$)\$\{?([A-Za-z_][A-Za-z0-9_]*)(:[-?+=][^}]*)?\}?/g;
  for (const m of compose.matchAll(REF)) {
    const name = m[1]!;
    const modifier = m[2] ?? "";
    if (env[name] !== undefined) continue;
    if (/^SERVICE_FQDN_/.test(name)) env[name] = "localhost";
    else if (/^SERVICE_URL_/.test(name)) env[name] = "http://localhost";
    else if (/^SERVICE_PASSWORD_64_/.test(name)) env[name] = "$generate:hex";
    else if (/^SERVICE_PASSWORD_/.test(name)) env[name] = "$generate:password";
    else if (/^SERVICE_USER_/.test(name)) env[name] = "$generate:user";
    else if (/^SERVICE_REALBASE64_/.test(name)) env[name] = "$generate:realbase64";
    else if (/^SERVICE_BASE64_(64|128)_/.test(name)) env[name] = "$generate:base64long";
    else if (/^SERVICE_BASE64_/.test(name)) env[name] = "$generate:base64";
    else if (modifier === "" || modifier.startsWith(":?")) {
      // a plain ${VAR} / ${VAR:?msg}: surface it (empty) so it shows up in the env editor.
      if (!/^(HOME|PATH|PWD|USER)$/.test(name)) env[name] = "";
    }
  }
  // Magic variables anywhere in the text — also nested ones such as ${KEY:?${SERVICE_PASSWORD_X}} and bare $SERVICE_X.
  for (const m of compose.matchAll(/SERVICE_[A-Z0-9_]+/g)) {
    const name = m[0];
    if (env[name] !== undefined) continue;
    if (/^SERVICE_FQDN_/.test(name)) env[name] = "localhost";
    else if (/^SERVICE_URL_/.test(name)) env[name] = "http://localhost";
    else if (/^SERVICE_PASSWORD_64_/.test(name)) env[name] = "$generate:hex";
    else if (/^SERVICE_PASSWORD_/.test(name)) env[name] = "$generate:password";
    else if (/^SERVICE_USER_/.test(name)) env[name] = "$generate:user";
    else if (/^SERVICE_REALBASE64_/.test(name)) env[name] = "$generate:realbase64";
    else if (/^SERVICE_BASE64_(64|128)_/.test(name)) env[name] = "$generate:base64long";
    else if (/^SERVICE_BASE64_/.test(name)) env[name] = "$generate:base64";
  }

  const rawCategory = (header(text, "category") ?? "other").split(",")[0]!.trim().toLowerCase();
  const category = CATEGORY_MAP[rawCategory] ?? "other";
  const slogan = header(text, "slogan") ?? `${key2name(key)} — template do Coolify.`;
  const docsRaw = header(text, "documentation");
  const docs = docsRaw ? docsRaw.replace(/[?&]utm_source=coolify\.io/, "") : null;
  const tags = (header(text, "tags") ?? "").split(",").map((t) => t.trim()).filter(Boolean).slice(0, 8);
  const logoRel = header(text, "logo");
  const logoSrc = logoRel ? join(LOGOS_SRC, logoRel) : null;
  const logo = logoSrc && existsSync(logoSrc) ? `${key}${logoRel!.slice(logoRel!.lastIndexOf("."))}` : undefined;

  const notes: string[] = [];
  if (/^\s+privileged:\s*true/m.test(compose)) notes.push("Este serviço roda com `privileged: true`: dá ao container poder sobre o servidor.");
  if (/^\s+network_mode:\s*['"]?host/m.test(compose)) notes.push("Usa `network_mode: host`: o container compartilha a rede do servidor.");
  if (/^\s+ports:/m.test(compose)) notes.push("Publica portas direto no servidor (`ports:`); confira conflitos com outros recursos.");

  const q = (s: string) => JSON.stringify(s);
  const out: string[] = [
    "# Importado do catálogo de templates do Coolify (Apache-2.0) por scripts/import-coolify-templates.ts — ver NOTICE.",
    `name: ${q(key2name(key))}`,
    `description: ${q(slogan)}`,
    `icon: ${CATEGORY_ICON[category] ?? "widgets"}`,
    ...(logo ? [`logo: ${q(logo)}`] : []),
    `category: ${category}`,
    ...(tags.length ? [`tags: [${tags.map(q).join(", ")}]`] : []),
    ...(docs ? [`docs: ${q(docs)}`] : []),
    ...(notes.length ? [`notes: ${q(notes.join(" "))}`] : []),
    `main: ${q(main)}`,
    `port: ${port}`,
    Object.keys(env).length ? "env:" : "env: {}",
    ...Object.entries(env).map(([k, v]) => `  ${k}: ${q(v)}`),
    "compose: |",
    ...compose.split("\n").map((l) => (l === "" ? "" : `  ${l}`)),
  ];
  return { key, yaml: out.join("\n").replace(/\n+$/, "\n"), logo: logo ? logoRel! : undefined };
}

const results: Result[] = [];
for (const file of readdirSync(SRC).filter((f) => f.endsWith(".yaml")).sort()) {
  const key = file.replace(/\.yaml$/, "");
  if (existsSync(join(OUT, `${key}.yml`)) && !readFileSync(join(OUT, `${key}.yml`), "utf8").startsWith("# Importado do catálogo")) {
    results.push({ key, skip: "já existe um template escrito à mão no yeah (mantido)" });
    continue;
  }
  results.push(convert(key, readFileSync(join(SRC, file), "utf8")));
}

const ok = results.filter((r) => r.yaml);
const skipped = results.filter((r) => r.skip);
console.log(`convertidos: ${ok.length} | pulados: ${skipped.length}`);
for (const s of skipped) console.log(`  - ${s.key}: ${s.skip}`);
if (!DRY) {
  mkdirSync(LOGOS_OUT, { recursive: true });
  for (const r of ok) {
    writeFileSync(join(OUT, `${r.key}.yml`), r.yaml!);
    if (r.logo) copyFileSync(join(LOGOS_SRC, r.logo), join(LOGOS_OUT, `${r.key}${r.logo.slice(r.logo.lastIndexOf("."))}`));
  }
}
