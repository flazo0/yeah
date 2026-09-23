import { shellQuote } from "./shell";

export type TeamRole = "owner" | "admin" | "member";

export type ServerStatus = "pending" | "connected" | "error";
export type ProxyStatus = "inactive" | "provisioning" | "active" | "error";

export interface SafeUser {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
}

export interface TeamDto {
  id: string;
  name: string;
  description: string | null;
  personal: boolean;
  role: TeamRole;
  createdAt: string;
}

export interface TeamOverviewDto {
  counts: {
    applications: number;
    databases: number;
    services: number;
    servers: number;
  };
  recentDeployments: Array<{
    id: string;
    applicationId: string;
    applicationName: string;
    status: DeploymentStatus;
    createdAt: string;
  }>;
}

export interface TeamInvitationDto {
  id: string;
  teamId: string;
  email: string;
  role: TeamRole;
  acceptedAt: string | null;
  createdAt: string;
}

export interface ServerDto {
  id: string;
  teamId: string;
  name: string;
  host: string;
  port: number;
  sshUser: string;
  status: ServerStatus;
  dockerVersion: string | null;
  lastCheckedAt: string | null;
  wildcardDomain: string | null;
  acmeEmail: string | null;
  proxyStatus: ProxyStatus;
  cpuPercent: number | null;
  memPercent: number | null;
  diskPercent: number | null;
  metricsCheckedAt: string | null;
  createdAt: string;
}

export interface ProjectDto {
  id: string;
  teamId: string;
  name: string;
  environmentCount: number;
  resourceCount: number;
  createdAt: string;
}

export interface EnvironmentDto {
  id: string;
  projectId: string;
  name: string;
  applicationCount: number;
  databaseCount: number;
  serviceCount: number;
  createdAt: string;
}

export interface TestConnectionResult {
  ok: boolean;
  dockerVersion?: string;
  error?: string;
}

export interface ApiErrorBody {
  error: string;
}

export type BuildPack = "dockerfile";
export type ApplicationStatus = "idle" | "deploying" | "running" | "stopped" | "error";
export type ApplicationLifecycleAction = "start" | "stop" | "restart";
export type DeploymentStatus = "queued" | "running" | "success" | "failed";

/** `docker run --memory=<memoryLimitMb>m --cpus=<cpuLimit>` — null in either means unlimited. */
export interface ResourceLimits {
  memoryLimitMb: number | null;
  cpuLimit: number | null;
}

/** Builds the `docker run` flags for whichever limits are set — empty string if neither is. */
export function resourceLimitFlags(limits: ResourceLimits): string {
  const flags: string[] = [];
  if (limits.memoryLimitMb) flags.push(`--memory=${limits.memoryLimitMb}m`);
  if (limits.cpuLimit) flags.push(`--cpus=${limits.cpuLimit}`);
  return flags.length > 0 ? `${flags.join(" ")} ` : "";
}

export interface ApplicationDto extends ResourceLimits {
  id: string;
  teamId: string;
  environmentId: string;
  serverId: string;
  serverName: string;
  name: string;
  repoUrl: string;
  branch: string;
  buildPack: BuildPack;
  port: number;
  envContent: string;
  domain: string | null;
  githubRepo: string | null;
  healthPath: string | null;
  healthIntervalSeconds: number;
  healthTimeoutSeconds: number;
  healthRetries: number;
  healthStartPeriodSeconds: number;
  dockerOptions: string;
  stopGraceSeconds: number;
  /** Whether a manual-deploy webhook token exists (the token itself is never returned after generation). */
  hasDeployToken: boolean;
  status: ApplicationStatus;
  createdAt: string;
}

export interface ApplicationVolumeDto {
  id: string;
  applicationId: string;
  name: string;
  mountPath: string;
  createdAt: string;
}

/** The actual docker volume name for a persistent storage row — one source of truth, id-derived so it never collides. */
export function volumeName(volumeId: string): string {
  return `yeah-vol-${volumeId}`;
}

/** Builds `-v` flags for every configured persistent storage mount — empty string if there are none. */
export function volumeFlags(volumes: Array<{ id: string; mountPath: string }>): string {
  if (volumes.length === 0) return "";
  return volumes.map((v) => `-v ${shellQuote(volumeName(v.id))}:${shellQuote(v.mountPath)} `).join("");
}

export interface DeploymentDto {
  id: string;
  applicationId: string;
  status: DeploymentStatus;
  log: string;
  commitSha: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export type DatabaseEngine = "postgresql" | "mysql" | "mariadb" | "redis" | "mongodb";
export type DatabaseStatus = "idle" | "provisioning" | "running" | "error";
export type BackupExecutionStatus = "queued" | "running" | "success" | "failed";

export interface DatabaseEngineInfo {
  label: string;
  defaultImage: string;
  defaultPort: number;
  /** Redis has no concept of a login user or a named database — just a password. */
  hasUsername: boolean;
  hasDatabaseName: boolean;
  icon: string;
  description: string;
  website: string;
  docsUrl: string;
}

export const DATABASE_ENGINES: Record<DatabaseEngine, DatabaseEngineInfo> = {
  postgresql: { label: "PostgreSQL", defaultImage: "postgres:16-alpine", defaultPort: 5432, hasUsername: true, hasDatabaseName: true, icon: "database", description: "Banco relacional com forte suporte a SQL padrão e extensibilidade.", website: "https://www.postgresql.org", docsUrl: "https://www.postgresql.org/docs/" },
  mysql: { label: "MySQL", defaultImage: "mysql:8", defaultPort: 3306, hasUsername: true, hasDatabaseName: true, icon: "database", description: "Banco relacional pra aplicações web e uso geral.", website: "https://www.mysql.com", docsUrl: "https://dev.mysql.com/doc/" },
  mariadb: { label: "MariaDB", defaultImage: "mariadb:11", defaultPort: 3306, hasUsername: true, hasDatabaseName: true, icon: "database", description: "Banco relacional, substituto direto do MySQL.", website: "https://mariadb.org", docsUrl: "https://mariadb.com/kb/en/documentation/" },
  redis: { label: "Redis", defaultImage: "redis:7-alpine", defaultPort: 6379, hasUsername: false, hasDatabaseName: false, icon: "bolt", description: "Armazenamento chave-valor em memória: cache, filas e broker de mensagens.", website: "https://redis.io", docsUrl: "https://redis.io/docs/" },
  mongodb: { label: "MongoDB", defaultImage: "mongo:7", defaultPort: 27017, hasUsername: true, hasDatabaseName: true, icon: "eco", description: "Banco de documentos NoSQL, esquema flexível.", website: "https://www.mongodb.com", docsUrl: "https://www.mongodb.com/docs/" },
};

export interface DatabaseDto extends ResourceLimits {
  id: string;
  teamId: string;
  environmentId: string;
  serverId: string;
  serverName: string;
  name: string;
  engine: DatabaseEngine;
  image: string;
  port: number;
  username: string | null;
  databaseName: string | null;
  status: DatabaseStatus;
  createdAt: string;
}

export interface BackupScheduleDto {
  id: string;
  databaseId: string;
  enabled: boolean;
  cron: string;
  timezone: string;
  timeoutSeconds: number;
  retentionCount: number;
  retentionDays: number;
  retentionSizeGb: number;
  /** null = dump stays on the target server's disk; set = uploaded to this S3 destination. */
  storageId: string | null;
  createdAt: string;
}

export interface BackupExecutionDto {
  id: string;
  scheduleId: string;
  status: BackupExecutionStatus;
  log: string;
  filePath: string | null;
  s3StorageId: string | null;
  sizeBytes: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface S3StorageDto {
  id: string;
  teamId: string;
  name: string;
  endpoint: string | null;
  region: string;
  bucket: string;
  accessKeyId: string;
  createdAt: string;
}

export interface GithubInstallationDto {
  id: string;
  teamId: string;
  installationId: number;
  accountLogin: string;
  accountType: string;
  createdAt: string;
}

export interface SearchResultDto {
  kind: "project" | "server" | "application" | "database" | "service";
  id: string;
  name: string;
  subtitle: string;
  path: string;
}

export interface GithubSourceResourceDto {
  applicationId: string;
  applicationName: string;
  repo: string;
  branch: string;
  projectId: string;
  projectName: string;
  environmentId: string;
  environmentName: string;
}

export interface GithubRepoDto {
  fullName: string;
  defaultBranch: string;
  private: boolean;
}

export type ServiceStatus = "idle" | "provisioning" | "running" | "error";

export interface ServiceDto extends ResourceLimits {
  id: string;
  teamId: string;
  environmentId: string;
  serverId: string;
  serverName: string;
  name: string;
  catalogKey: string;
  image: string;
  port: number;
  envContent: string;
  domain: string | null;
  status: ServiceStatus;
  createdAt: string;
}

export type NotificationChannelType = "discord" | "slack" | "telegram" | "webhook" | "email";

export type NotificationEventType =
  | "deploy.success"
  | "deploy.failed"
  | "backup.failed"
  | "server.down"
  | "server.reconnected"
  | "server.metrics"
  | "tls.expiring";

export const NOTIFICATION_EVENT_LABELS: Record<NotificationEventType, string> = {
  "deploy.success": "Deploy concluído",
  "deploy.failed": "Deploy falhou",
  "backup.failed": "Backup falhou",
  "server.down": "Servidor caiu",
  "server.reconnected": "Servidor reconectou",
  "server.metrics": "CPU/RAM/disco no limite",
  "tls.expiring": "Certificado TLS perto de expirar",
};

export interface NotificationChannelDto {
  id: string;
  teamId: string;
  name: string;
  type: NotificationChannelType;
  url: string | null;
  telegramChatId: string | null;
  // Secrets (telegramBotToken, smtpPassword) are deliberately never sent back to the frontend.
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecure: boolean | null;
  smtpUser: string | null;
  smtpFrom: string | null;
  emailTo: string | null;
  // null = recebe todos os tipos de evento (padrão). Setado = só esses.
  events: NotificationEventType[] | null;
  enabled: boolean;
  createdAt: string;
}

export type PlatformOperationKind = "platform_update" | "system_update";
export type PlatformOperationStatus = "queued" | "running" | "success" | "failed";

export interface PlatformOperationDto {
  id: string;
  kind: PlatformOperationKind;
  status: PlatformOperationStatus;
  log: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

/** One row per database/service actually using an image — the "atualizar"/"atualizar tudo"
 * buttons act on these directly instead of a deduped-by-image-string list. */
export interface ImageUpdateResourceDto {
  resourceType: "database" | "service";
  resourceId: string;
  resourceName: string;
  image: string;
  currentTag: string;
  latestTag: string | null;
  updateAvailable: boolean | null;
}

export interface SystemImageUpdateDto {
  image: string;
  currentTag: string;
  latestTag: string | null;
  updateAvailable: boolean | null;
}

/** Messages broadcast over the dedicated `ws` service, fanned out via Redis pub/sub. */
export type WsServerEvent =
  | { type: "server.status"; serverId: string; status: ServerStatus; dockerVersion?: string }
  | { type: "server.proxy"; serverId: string; proxyStatus: ProxyStatus }
  | { type: "server.metrics"; serverId: string; cpuPercent: number; memPercent: number; diskPercent: number }
  | { type: "service.status"; serviceId: string; status: ServiceStatus }
  | { type: "application.status"; applicationId: string; status: ApplicationStatus }
  | { type: "deployment.log"; deploymentId: string; line: string }
  | { type: "deployment.status"; deploymentId: string; status: DeploymentStatus }
  | { type: "database.status"; databaseId: string; status: DatabaseStatus }
  | { type: "backup.status"; executionId: string; scheduleId: string; status: BackupExecutionStatus }
  | { type: "platform-operation.log"; operationId: string; line: string }
  | { type: "platform-operation.status"; operationId: string; status: PlatformOperationStatus };
