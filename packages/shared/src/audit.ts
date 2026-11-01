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
  | "session"
  | "other";

export interface AuditEventDto {
  id: string;
  teamId: string;
  /** Who: the person's email, "API token: <name>", or null when unknown. */
  actor: string | null;
  action: string;
  level: AuditLevel;
  resourceType: AuditResourceType;
  resourceId: string | null;
  /** Current name of the resource when it still exists. */
  resourceName: string | null;
  /** Client address, when it was known (sign-ins and token calls). */
  ip: string | null;
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
  servers: { type: "server", noun: "server" },
  applications: { type: "application", noun: "application" },
  services: { type: "service", noun: "service" },
  databases: { type: "database", noun: "database" },
  projects: { type: "project", noun: "project" },
  environments: { type: "environment", noun: "environment" },
  notifications: { type: "notification", noun: "notification channel" },
  variables: { type: "variable", noun: "shared variable" },
  tags: { type: "tag", noun: "tag" },
  registries: { type: "registry", noun: "registry" },
  "ssh-keys": { type: "ssh-key", noun: "SSH key" },
  storages: { type: "storage", noun: "S3 storage" },
  "git-sources": { type: "git-source", noun: "Git source" },
  "log-drains": { type: "log-drain", noun: "log destination" },
  "api-tokens": { type: "api-token", noun: "API token" },
};

/** Sub-actions that read better than "changed X": `POST .../deploy`, `PUT .../domain`… */
const ACTIONS: Record<string, string> = {
  deploy: "Started a deployment",
  start: "Started",
  stop: "Stopped",
  restart: "Restarted",
  rollback: "Rolled back",
  domain: "Changed the domains",
  domains: "Changed the domains",
  env: "Changed the environment variables",
  limits: "Changed the resource limits",
  sleep: "Changed the sleep-when-idle mode",
  source: "Changed the source",
  advanced: "Changed the advanced settings",
  backup: "Ran a backup",
  restore: "Restored a backup",
  patches: "Touched the system updates",
  "docker-images": "Touched the Docker images",
  "docker-cleanup": "Touched the Docker cleanup",
  proxy: "Touched the proxy",
  volumes: "Changed the volumes",
  tags: "Changed the tags",
  "file-save": "Edited a file in the container",
  "file-upload": "Uploaded a file to the container",
  "file-mkdir": "Created a folder in the container",
  "file-delete": "Deleted a file or folder in the container",
  "move-resource": "Moved a resource to another environment",
};

// "mcp" is one JSON-RPC endpoint for reads and writes alike; its mutating tools are recorded by the route itself.
const SKIPPED_SEGMENTS = new Set(["terminal", "search", "health", "audit", "ws", "mcp"]);

/**
 * Describes a mutating request for the audit log, or returns null for anything that should not be
 * recorded: reads, failed requests, paths outside a team, noisy endpoints.
 */
export function describeAuditRequest(method: string, pathname: string, status: number): AuditRequestInfo | null {
  const m = method.toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return null;
  if (status >= 400) return null;
  let segments = pathname.split("/").filter(Boolean);
  // The versioned token API (`/api/v1/teams/...`) mirrors the team routes.
  if (segments[0] === "api" && segments[1] === "v1") segments = segments.slice(2);
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
    action = `Created ${noun || "resource"}`;
  } else if (m === "DELETE" && sub.length === 0) {
    action = `Deleted ${noun || "resource"}`;
  } else if (sub.length === 0) {
    action = `Changed ${noun || "resource"}`;
  } else {
    action = `${m === "DELETE" ? "Removed" : "Changed"} ${sub.join("/")} (${noun || "resource"})`;
  }
  return { teamId, action, level: m === "DELETE" || last === "stop" || last === "file-delete" ? "warning" : "info", resourceType, resourceId, ids };
}

export type AuthEventKind = "sign-in" | "sign-in-passkey" | "sign-in-failed" | "second-factor-failed" | "sign-out";

export interface AuthEventInfo {
  action: string;
  level: AuditLevel;
}

/** What the audit log says for an authentication event. Failures are warnings so they stand out. */
export function describeAuthEvent(kind: AuthEventKind): AuthEventInfo {
  switch (kind) {
    case "sign-in":
      return { action: "Signed in", level: "info" };
    case "sign-in-passkey":
      return { action: "Signed in with a passkey", level: "info" };
    case "sign-in-failed":
      return { action: "Failed sign-in attempt (wrong password)", level: "warning" };
    case "second-factor-failed":
      return { action: "Failed sign-in attempt (wrong two-factor code)", level: "warning" };
    case "sign-out":
      return { action: "Signed out", level: "info" };
  }
}
