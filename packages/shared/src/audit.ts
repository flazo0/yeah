// Audit log: every change a person (or an API token) makes through the API is recorded with what was
// touched, never with the request body (it may carry secrets). The description is derived from the
// request path alone so no route needs to opt in.

export type AuditLevel = "info" | "warning";

export type AuditResourceType =
  | "server"
  | "application"
  | "service"
  | "database"
  | "project"
  | "environment"
  | "notification"
  | "variable"
  | "tag"
  | "registry"
  | "ssh-key"
  | "storage"
  | "git-source"
  | "log-drain"
  | "api-token"
  | "team"
  | "other";

export interface AuditEventDto {
  id: string;
  teamId: string;
  /** Who: the person's email, "token de API", or null when unknown. */
  actor: string | null;
  action: string;
  level: AuditLevel;
  resourceType: AuditResourceType;
  resourceId: string | null;
  /** Current name of the resource when it still exists. */
  resourceName: string | null;
  method: string;
  path: string;
  createdAt: string;
}

export interface AuditRequestInfo {
  teamId: string;
  action: string;
  level: AuditLevel;
  resourceType: AuditResourceType;
  resourceId: string | null;
  /** Ids found in the path, by kind — used to resolve names when listing. */
  ids: Partial<Record<"server" | "application" | "service" | "database" | "project", string>>;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UUID_RE = new RegExp(`^${UUID}$`, "i");

const COLLECTIONS: Record<string, { type: AuditResourceType; noun: string }> = {
  servers: { type: "server", noun: "servidor" },
  applications: { type: "application", noun: "aplicação" },
  services: { type: "service", noun: "serviço" },
  databases: { type: "database", noun: "banco de dados" },
  projects: { type: "project", noun: "projeto" },
  environments: { type: "environment", noun: "ambiente" },
  notifications: { type: "notification", noun: "canal de notificação" },
  variables: { type: "variable", noun: "variável compartilhada" },
  tags: { type: "tag", noun: "tag" },
  registries: { type: "registry", noun: "registry" },
  "ssh-keys": { type: "ssh-key", noun: "chave SSH" },
  storages: { type: "storage", noun: "storage S3" },
  "git-sources": { type: "git-source", noun: "fonte Git" },
  "log-drains": { type: "log-drain", noun: "destino de logs" },
  "api-tokens": { type: "api-token", noun: "token de API" },
};

/** Sub-actions that read better than "changed X": `POST .../deploy`, `PUT .../domain`… */
const ACTIONS: Record<string, string> = {
  deploy: "Iniciou um deploy",
  start: "Iniciou",
  stop: "Parou",
  restart: "Reiniciou",
  rollback: "Fez rollback",
  domain: "Alterou os domínios",
  domains: "Alterou os domínios",
  env: "Alterou as variáveis de ambiente",
  limits: "Alterou os limites de recursos",
  sleep: "Alterou o modo dormir quando ocioso",
  source: "Alterou a origem",
  advanced: "Alterou as configurações avançadas",
  backup: "Executou um backup",
  restore: "Restaurou um backup",
  patches: "Mexeu nas atualizações do sistema",
  "docker-images": "Mexeu nas imagens Docker",
  "docker-cleanup": "Mexeu na limpeza do Docker",
  proxy: "Mexeu no proxy",
  volumes: "Alterou os volumes",
  tags: "Alterou as tags",
};

const SKIPPED_SEGMENTS = new Set(["terminal", "search", "health", "audit", "ws"]);

/**
 * Describes a mutating request for the audit log, or returns null for anything that should not be
 * recorded: reads, failed requests, paths outside a team, noisy endpoints.
 */
export function describeAuditRequest(method: string, pathname: string, status: number): AuditRequestInfo | null {
  const m = method.toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return null;
  if (status >= 400) return null;
  const segments = pathname.split("/").filter(Boolean);
  if (segments.some((s) => SKIPPED_SEGMENTS.has(s))) return null;
  if (segments[0] !== "teams" || !segments[1] || !UUID_RE.test(segments[1])) return null;
  const teamId = segments[1]!;

  const ids: AuditRequestInfo["ids"] = {};
  let resourceType: AuditResourceType = "other";
  let noun = "";
  let resourceId: string | null = null;
  let tail: string[] = [];
  for (let i = 2; i < segments.length; i++) {
    const collection = COLLECTIONS[segments[i]!];
    if (!collection) {
      tail.push(segments[i]!);
      continue;
    }
    resourceType = collection.type;
    noun = collection.noun;
    const next = segments[i + 1];
    resourceId = next && UUID_RE.test(next) ? next : null;
    if (resourceId) {
      if (collection.type === "server" || collection.type === "application" || collection.type === "service" || collection.type === "database" || collection.type === "project") ids[collection.type] = resourceId;
      i++;
    }
    tail = [];
  }
  const sub = tail.filter((s) => !UUID_RE.test(s));
  const last = sub[sub.length - 1];

  let action: string;
  if (last && ACTIONS[last]) {
    action = ACTIONS[last]!;
  } else if (m === "POST" && !resourceId && sub.length === 0) {
    action = `Criou ${noun || "recurso"}`;
  } else if (m === "DELETE" && sub.length === 0) {
    action = `Excluiu ${noun || "recurso"}`;
  } else if (sub.length === 0) {
    action = `Alterou ${noun || "recurso"}`;
  } else {
    action = `${m === "DELETE" ? "Removeu" : "Alterou"} ${sub.join("/")} (${noun || "recurso"})`;
  }
  return { teamId, action, level: m === "DELETE" || last === "stop" ? "warning" : "info", resourceType, resourceId, ids };
}
