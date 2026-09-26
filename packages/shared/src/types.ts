import type { StackDomain } from "./composeStack";
import type { WwwRedirect } from "./traefik";
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
  sshTimeoutSeconds: number;
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

export type BuildPack = "dockerfile" | "static" | "nixpacks" | "railpack" | "image" | "dockerfile_inline" | "docker_compose";

/** Build packs that clone a Git repository (the others start from an image or pasted text). */
export function buildPackUsesGit(buildPack: BuildPack): boolean {
  return buildPack === "dockerfile" || buildPack === "static" || buildPack === "nixpacks" || buildPack === "railpack" || buildPack === "docker_compose";
}
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
  dockerImage: string | null;
  dockerfileContent: string | null;
  publishDirectory: string;
  /** docker_compose only: compose file inside the repo, and the service the domain/port routes to. */
  composeFile: string;
  composeService: string | null;
  /** Public half of the deploy key, to register on the repository — the private half is never returned. */
  deployKeyPublic: string | null;
  port: number;
  envContent: string;
  domain: string | null;
  extraDomains: string[];
  wwwRedirect: WwwRedirect;
  registryId: string | null;
  registryImage: string | null;
  /** Set when the code comes from a GitLab / Bitbucket / Gitea source. */
  gitSourceId: string | null;
  gitRepo: string | null;
  /** Opted in to PR previews (parent apps only). */
  previewEnabled: boolean;
  /** Set on a preview: the app it was copied from and the PR it shows. */
  previewOfId: string | null;
  prNumber: number | null;
  /** Labels of settings changed since the last deploy; null when the app was never deployed. */
  pendingChanges: string[] | null;
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

/** volume = named docker volume; bind = a directory of the host; file = a file whose content lives in the panel. */
export type VolumeKind = "volume" | "bind" | "file";
export const VOLUME_KINDS: VolumeKind[] = ["volume", "bind", "file"];

export interface ApplicationVolumeDto {
  id: string;
  applicationId: string;
  name: string;
  mountPath: string;
  kind: VolumeKind;
  /** bind only: absolute path on the server. */
  hostPath: string | null;
  /** file only: the file's content. */
  fileContent: string | null;
  createdAt: string;
}

/** Where a "file" volume is written on the server; bind-mounted into the container. */
export function volumeFilePath(applicationId: string, volumeId: string): string {
  return `/opt/yeah-apps/${applicationId}/files/${volumeId}`;
}

/** The actual docker volume name for a persistent storage row — one source of truth, id-derived so it never collides. */
export function volumeName(volumeId: string): string {
  return `yeah-vol-${volumeId}`;
}

/** Builds `-v` flags for every configured persistent storage mount — empty string if there are none. */
export function volumeFlags(
  volumes: Array<{ id: string; mountPath: string; kind?: VolumeKind; hostPath?: string | null }>,
  /** Needed for "file" volumes: the application id, to locate the file written on the server. */
  applicationId?: string,
): string {
  if (volumes.length === 0) return "";
  return volumes
    .map((v) => {
      if (v.kind === "bind" && v.hostPath) return `-v ${shellQuote(v.hostPath)}:${shellQuote(v.mountPath)} `;
      if (v.kind === "file" && applicationId) return `-v ${shellQuote(volumeFilePath(applicationId, v.id))}:${shellQuote(v.mountPath)} `;
      return `-v ${shellQuote(volumeName(v.id))}:${shellQuote(v.mountPath)} `;
    })
    .join("");
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

export type DatabaseEngine = "postgresql" | "mysql" | "mariadb" | "redis" | "keydb" | "dragonfly" | "mongodb" | "clickhouse";
export type DatabaseStatus = "idle" | "provisioning" | "running" | "error";
export type BackupExecutionStatus = "queued" | "running" | "success" | "failed";

export interface DatabaseEngineInfo {
  label: string;
  defaultImage: string;
  /** Image repository without a tag — the creation form asks for the version (tag) separately. */
  imageRepo: string;
  /** Suggested tags, newest first; the form also accepts any other tag. */
  versions: string[];
  /** Port the engine listens on inside its container. */
  internalPort: number;
  /** Port published on the server when public access is on (also the default). */
  defaultPort: number;
  /** Whether the panel can dump this engine (Dragonfly has no client in its image). */
  supportsBackup: boolean;
  /** Whether the panel can turn TLS on for it. */
  supportsSsl: boolean;
  /** Redis has no concept of a login user or a named database — just a password. */
  hasUsername: boolean;
  hasDatabaseName: boolean;
  icon: string;
  description: string;
  website: string;
  docsUrl: string;
}

export const DATABASE_ENGINES: Record<DatabaseEngine, DatabaseEngineInfo> = {
  postgresql: { label: "PostgreSQL", defaultImage: "postgres:16-alpine", imageRepo: "postgres", versions: ["17-alpine", "16-alpine", "15-alpine", "14-alpine", "13-alpine"], internalPort: 5432, defaultPort: 5432, supportsBackup: true, supportsSsl: true, hasUsername: true, hasDatabaseName: true, icon: "database", description: "Banco relacional com forte suporte a SQL padrão e extensibilidade.", website: "https://www.postgresql.org", docsUrl: "https://www.postgresql.org/docs/" },
  mysql: { label: "MySQL", defaultImage: "mysql:8", imageRepo: "mysql", versions: ["9", "8.4", "8", "5.7"], internalPort: 3306, defaultPort: 3306, supportsBackup: true, supportsSsl: true, hasUsername: true, hasDatabaseName: true, icon: "database", description: "Banco relacional pra aplicações web e uso geral.", website: "https://www.mysql.com", docsUrl: "https://dev.mysql.com/doc/" },
  mariadb: { label: "MariaDB", defaultImage: "mariadb:11", imageRepo: "mariadb", versions: ["11", "10.11", "10.6"], internalPort: 3306, defaultPort: 3306, supportsBackup: true, supportsSsl: true, hasUsername: true, hasDatabaseName: true, icon: "database", description: "Banco relacional, substituto direto do MySQL.", website: "https://mariadb.org", docsUrl: "https://mariadb.com/kb/en/documentation/" },
  redis: { label: "Redis", defaultImage: "redis:7-alpine", imageRepo: "redis", versions: ["8-alpine", "7-alpine", "6-alpine"], internalPort: 6379, defaultPort: 6379, supportsBackup: true, supportsSsl: true, hasUsername: false, hasDatabaseName: false, icon: "bolt", description: "Armazenamento chave-valor em memória: cache, filas e broker de mensagens.", website: "https://redis.io", docsUrl: "https://redis.io/docs/" },
  keydb: { label: "KeyDB", defaultImage: "eqalpha/keydb:latest", imageRepo: "eqalpha/keydb", versions: ["latest", "x86_64_v6.3.4"], internalPort: 6379, defaultPort: 6379, supportsBackup: true, supportsSsl: true, hasUsername: false, hasDatabaseName: false, icon: "bolt", description: "Fork multithread do Redis, compatível com o protocolo.", website: "https://docs.keydb.dev", docsUrl: "https://docs.keydb.dev/docs/" },
  dragonfly: { label: "Dragonfly", defaultImage: "docker.dragonflydb.io/dragonflydb/dragonfly:latest", imageRepo: "docker.dragonflydb.io/dragonflydb/dragonfly", versions: ["latest", "v1.25.0"], internalPort: 6379, defaultPort: 6379, supportsBackup: false, supportsSsl: true, hasUsername: false, hasDatabaseName: false, icon: "bolt", description: "Substituto moderno e rápido do Redis, compatível com o protocolo.", website: "https://www.dragonflydb.io", docsUrl: "https://www.dragonflydb.io/docs" },
  mongodb: { label: "MongoDB", defaultImage: "mongo:7", imageRepo: "mongo", versions: ["8", "7", "6"], internalPort: 27017, defaultPort: 27017, supportsBackup: true, supportsSsl: true, hasUsername: true, hasDatabaseName: true, icon: "eco", description: "Banco de documentos NoSQL, esquema flexível.", website: "https://www.mongodb.com", docsUrl: "https://www.mongodb.com/docs/" },
  clickhouse: { label: "ClickHouse", defaultImage: "clickhouse/clickhouse-server:latest", imageRepo: "clickhouse/clickhouse-server", versions: ["latest", "24.8", "23.8"], internalPort: 8123, defaultPort: 8123, supportsBackup: true, supportsSsl: false, hasUsername: true, hasDatabaseName: true, icon: "monitoring", description: "Banco colunar pra analytics e grandes volumes de eventos (interface HTTP na 8123).", website: "https://clickhouse.com", docsUrl: "https://clickhouse.com/docs" },
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
  /** Publish the port on the server so it is reachable from outside (off = only the environment's network). */
  publicAccess: boolean;
  ssl: boolean;
  /** Name other resources of the environment use to connect (docker network alias). */
  internalHost: string;
  healthEnabled: boolean;
  healthIntervalSeconds: number;
  healthTimeoutSeconds: number;
  healthRetries: number;
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
  /** Comma-separated databases to include from a multi-database instance; null = the primary one. */
  databases: string | null;
  createdAt: string;
}

export interface DatabaseRestoreDto {
  id: string;
  databaseId: string;
  status: BackupExecutionStatus;
  sourceLabel: string;
  log: string;
  startedAt: string | null;
  finishedAt: string | null;
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

export type ServiceStatus = "idle" | "provisioning" | "running" | "stopped" | "error";

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
  /** Stack services only: the compose file and the containers/domains built on it. */
  composeContent: string | null;
  templateKey: string | null;
  mainService: string | null;
  domains: StackDomain[];
  stackServices: string[];
  lastLog: string;
  status: ServiceStatus;
  createdAt: string;
}

export interface ServiceContainerDto {
  name: string;
  service: string;
  image: string;
  state: string;
  status: string;
}

export type NotificationChannelType = "discord" | "slack" | "telegram" | "webhook" | "email";

export type NotificationEventType =
  | "deploy.success"
  | "deploy.failed"
  | "backup.failed"
  | "task.failed"
  | "server.down"
  | "server.reconnected"
  | "server.metrics"
  | "tls.expiring";

export const NOTIFICATION_EVENT_LABELS: Record<NotificationEventType, string> = {
  "deploy.success": "Deploy concluído",
  "deploy.failed": "Deploy falhou",
  "backup.failed": "Backup falhou",
  "task.failed": "Tarefa agendada falhou",
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

export interface SharedVariableDto {
  id: string;
  scope: "team" | "project" | "environment";
  projectId: string | null;
  environmentId: string | null;
  key: string;
  value: string;
  createdAt: string;
}

export type TaskExecutionStatus = "running" | "success" | "failed";

export interface ScheduledTaskDto {
  id: string;
  applicationId: string;
  name: string;
  command: string;
  cron: string;
  timezone: string;
  timeoutSeconds: number;
  enabled: boolean;
  createdAt: string;
  lastExecution: { status: TaskExecutionStatus; startedAt: string; finishedAt: string | null } | null;
}

export interface ScheduledTaskExecutionDto {
  id: string;
  taskId: string;
  status: TaskExecutionStatus;
  log: string;
  exitCode: number | null;
  manual: boolean;
  startedAt: string;
  finishedAt: string | null;
}

export type TaggableType = "application" | "database" | "service";

export interface TagDto {
  id: string;
  name: string;
  color: string;
  /** Resources currently carrying this tag. */
  resources: { type: TaggableType; id: string }[];
}

export interface RegistryDto {
  id: string;
  name: string;
  host: string;
  username: string;
  /** The password is write-only: this only says one is stored. */
  hasPassword: boolean;
  createdAt: string;
}

export interface VolumeBackupDto {
  id: string;
  volumeId: string | null;
  /** True when the archive lives in S3 instead of on the server. */
  inS3: boolean;
  label: string;
  operation: "backup" | "restore";
  status: BackupExecutionStatus;
  log: string;
  sizeBytes: number | null;
  sourceBackupId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

/** A named volume of a service stack, as the backups screen lists it. */
export interface ServiceVolumeDto {
  key: string;
  dockerName: string;
}

export interface ServiceTemplateDto {
  key: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  website?: string;
  docsUrl?: string;
  notes?: string;
  /** The compose service that receives the domain. */
  mainService: string;
  /** Every service of the stack, for the card ("3 containers"). */
  services: string[];
}
