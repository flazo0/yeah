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
  personal: boolean;
  role: TeamRole;
  createdAt: string;
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
export type ApplicationStatus = "idle" | "deploying" | "running" | "error";
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
  status: ApplicationStatus;
  createdAt: string;
}

export interface DeploymentDto {
  id: string;
  applicationId: string;
  status: DeploymentStatus;
  log: string;
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
}

export const DATABASE_ENGINES: Record<DatabaseEngine, DatabaseEngineInfo> = {
  postgresql: { label: "PostgreSQL", defaultImage: "postgres:16-alpine", defaultPort: 5432, hasUsername: true, hasDatabaseName: true },
  mysql: { label: "MySQL", defaultImage: "mysql:8", defaultPort: 3306, hasUsername: true, hasDatabaseName: true },
  mariadb: { label: "MariaDB", defaultImage: "mariadb:11", defaultPort: 3306, hasUsername: true, hasDatabaseName: true },
  redis: { label: "Redis", defaultImage: "redis:7-alpine", defaultPort: 6379, hasUsername: false, hasDatabaseName: false },
  mongodb: { label: "MongoDB", defaultImage: "mongo:7", defaultPort: 27017, hasUsername: true, hasDatabaseName: true },
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

export type NotificationChannelType = "discord" | "slack" | "telegram" | "webhook";

export interface NotificationChannelDto {
  id: string;
  teamId: string;
  name: string;
  type: NotificationChannelType;
  url: string | null;
  telegramChatId: string | null;
  enabled: boolean;
  createdAt: string;
}

/** Messages broadcast over the dedicated `ws` service, fanned out via Redis pub/sub. */
export type WsServerEvent =
  | { type: "server.status"; serverId: string; status: ServerStatus; dockerVersion?: string }
  | { type: "server.proxy"; serverId: string; proxyStatus: ProxyStatus }
  | { type: "server.metrics"; serverId: string; cpuPercent: number; memPercent: number; diskPercent: number }
  | { type: "service.status"; serviceId: string; status: ServiceStatus }
  | { type: "deployment.log"; deploymentId: string; line: string }
  | { type: "deployment.status"; deploymentId: string; status: DeploymentStatus }
  | { type: "database.status"; databaseId: string; status: DatabaseStatus }
  | { type: "backup.status"; executionId: string; scheduleId: string; status: BackupExecutionStatus };
