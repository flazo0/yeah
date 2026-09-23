import Redis from "ioredis";
import { Queue, Worker, type Processor } from "bullmq";
import type { ApplicationLifecycleAction, WsServerEvent } from "@yeah/shared";

export const SERVER_CHECK_QUEUE = "server-check";
export const APPLICATION_DEPLOY_QUEUE = "application-deploy";
export const APPLICATION_LIFECYCLE_QUEUE = "application-lifecycle";
export const DATABASE_PROVISION_QUEUE = "database-provision";
export const DATABASE_BACKUP_QUEUE = "database-backup";
export const PROXY_PROVISION_QUEUE = "proxy-provision";
export const SERVICE_PROVISION_QUEUE = "service-provision";
export const SERVER_METRICS_QUEUE = "server-metrics";
export const TLS_CHECK_QUEUE = "tls-check";
export const PLATFORM_OPERATION_QUEUE = "platform-operation";
export const SERVER_EVENTS_CHANNEL = "server-events";
/** Fixed id for the single system-wide repeatable job that ticks the metrics poll — not per-server. */
export const SERVER_METRICS_SCHEDULER_ID = "system-server-metrics";
/** Fixed id for the single system-wide repeatable job that ticks the TLS expiry check. */
export const TLS_CHECK_SCHEDULER_ID = "system-tls-check";

export interface ServerCheckJobData {
  serverId: string;
}

export interface ApplicationDeployJobData {
  deploymentId: string;
}

export interface ApplicationLifecycleJobData {
  applicationId: string;
  action: ApplicationLifecycleAction;
}

export interface DatabaseProvisionJobData {
  databaseId: string;
}

export interface DatabaseBackupJobData {
  scheduleId: string;
  /** Set when a job was queued via "Backup Now" rather than the cron schedule. */
  manual?: boolean;
}

export interface ProxyProvisionJobData {
  serverId: string;
}

export interface ServiceProvisionJobData {
  serviceId: string;
}

export interface PlatformOperationJobData {
  operationId: string;
}

/** Tick job, no per-run data — it just re-checks every connected server each time it fires. */
export type ServerMetricsJobData = Record<string, never>;

/** Tick job, no per-run data — it re-checks every domain in use each time it fires. */
export type TlsCheckJobData = Record<string, never>;

/** Each queue/worker/pubsub role should get its own connection instance (ioredis convention). */
export function createRedisConnection(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null });
}

export function createServerCheckQueue(connection: Redis): Queue<ServerCheckJobData> {
  return new Queue<ServerCheckJobData>(SERVER_CHECK_QUEUE, { connection });
}

export function createServerCheckWorker(
  connection: Redis,
  processor: Processor<ServerCheckJobData>,
): Worker<ServerCheckJobData> {
  return new Worker<ServerCheckJobData>(SERVER_CHECK_QUEUE, processor, { connection });
}

export function createApplicationDeployQueue(connection: Redis): Queue<ApplicationDeployJobData> {
  return new Queue<ApplicationDeployJobData>(APPLICATION_DEPLOY_QUEUE, { connection });
}

export function createApplicationDeployWorker(
  connection: Redis,
  processor: Processor<ApplicationDeployJobData>,
): Worker<ApplicationDeployJobData> {
  return new Worker<ApplicationDeployJobData>(APPLICATION_DEPLOY_QUEUE, processor, { connection });
}

export function createApplicationLifecycleQueue(connection: Redis): Queue<ApplicationLifecycleJobData> {
  return new Queue<ApplicationLifecycleJobData>(APPLICATION_LIFECYCLE_QUEUE, { connection });
}

export function createApplicationLifecycleWorker(
  connection: Redis,
  processor: Processor<ApplicationLifecycleJobData>,
): Worker<ApplicationLifecycleJobData> {
  return new Worker<ApplicationLifecycleJobData>(APPLICATION_LIFECYCLE_QUEUE, processor, { connection });
}

export function createDatabaseProvisionQueue(connection: Redis): Queue<DatabaseProvisionJobData> {
  return new Queue<DatabaseProvisionJobData>(DATABASE_PROVISION_QUEUE, { connection });
}

export function createDatabaseProvisionWorker(
  connection: Redis,
  processor: Processor<DatabaseProvisionJobData>,
): Worker<DatabaseProvisionJobData> {
  return new Worker<DatabaseProvisionJobData>(DATABASE_PROVISION_QUEUE, processor, { connection });
}

export function createDatabaseBackupQueue(connection: Redis): Queue<DatabaseBackupJobData> {
  return new Queue<DatabaseBackupJobData>(DATABASE_BACKUP_QUEUE, { connection });
}

export function createDatabaseBackupWorker(
  connection: Redis,
  processor: Processor<DatabaseBackupJobData>,
): Worker<DatabaseBackupJobData> {
  return new Worker<DatabaseBackupJobData>(DATABASE_BACKUP_QUEUE, processor, { connection });
}

export function createProxyProvisionQueue(connection: Redis): Queue<ProxyProvisionJobData> {
  return new Queue<ProxyProvisionJobData>(PROXY_PROVISION_QUEUE, { connection });
}

export function createProxyProvisionWorker(
  connection: Redis,
  processor: Processor<ProxyProvisionJobData>,
): Worker<ProxyProvisionJobData> {
  return new Worker<ProxyProvisionJobData>(PROXY_PROVISION_QUEUE, processor, { connection });
}

export function createServiceProvisionQueue(connection: Redis): Queue<ServiceProvisionJobData> {
  return new Queue<ServiceProvisionJobData>(SERVICE_PROVISION_QUEUE, { connection });
}

export function createServiceProvisionWorker(
  connection: Redis,
  processor: Processor<ServiceProvisionJobData>,
): Worker<ServiceProvisionJobData> {
  return new Worker<ServiceProvisionJobData>(SERVICE_PROVISION_QUEUE, processor, { connection });
}

export function createServerMetricsQueue(connection: Redis): Queue<ServerMetricsJobData> {
  return new Queue<ServerMetricsJobData>(SERVER_METRICS_QUEUE, { connection });
}

export function createServerMetricsWorker(
  connection: Redis,
  processor: Processor<ServerMetricsJobData>,
): Worker<ServerMetricsJobData> {
  return new Worker<ServerMetricsJobData>(SERVER_METRICS_QUEUE, processor, { connection });
}

/** Called once at worker boot — idempotent (upsert), so restarting the worker never double-schedules it. */
export async function ensureServerMetricsScheduler(queue: Queue<ServerMetricsJobData>, everyMs = 60_000): Promise<void> {
  await queue.upsertJobScheduler(SERVER_METRICS_SCHEDULER_ID, { every: everyMs }, { data: {} });
}

export function createPlatformOperationQueue(connection: Redis): Queue<PlatformOperationJobData> {
  return new Queue<PlatformOperationJobData>(PLATFORM_OPERATION_QUEUE, { connection });
}

export function createPlatformOperationWorker(
  connection: Redis,
  processor: Processor<PlatformOperationJobData>,
): Worker<PlatformOperationJobData> {
  return new Worker<PlatformOperationJobData>(PLATFORM_OPERATION_QUEUE, processor, { connection });
}

export function createTlsCheckQueue(connection: Redis): Queue<TlsCheckJobData> {
  return new Queue<TlsCheckJobData>(TLS_CHECK_QUEUE, { connection });
}

export function createTlsCheckWorker(connection: Redis, processor: Processor<TlsCheckJobData>): Worker<TlsCheckJobData> {
  return new Worker<TlsCheckJobData>(TLS_CHECK_QUEUE, processor, { connection });
}

/** Called once at worker boot — idempotent (upsert). Certs don't need minute-level polling, so this defaults to once a day. */
export async function ensureTlsCheckScheduler(queue: Queue<TlsCheckJobData>, everyMs = 24 * 60 * 60 * 1000): Promise<void> {
  await queue.upsertJobScheduler(TLS_CHECK_SCHEDULER_ID, { every: everyMs }, { data: {} });
}

/** A schedule's job scheduler is keyed by `scheduleId` so it can be found again to remove or edit in place. */
export async function addBackupSchedule(
  queue: Queue<DatabaseBackupJobData>,
  scheduleId: string,
  cron: string,
  timezone: string,
): Promise<void> {
  await queue.upsertJobScheduler(scheduleId, { pattern: cron, tz: timezone }, { data: { scheduleId } });
}

export async function removeBackupSchedule(queue: Queue<DatabaseBackupJobData>, scheduleId: string): Promise<void> {
  await queue.removeJobScheduler(scheduleId);
}

export function publishServerEvent(connection: Redis, event: WsServerEvent): Promise<number> {
  return connection.publish(SERVER_EVENTS_CHANNEL, JSON.stringify(event));
}

/** `connection` is dedicated to this subscription once called — ioredis puts it in subscriber mode. */
export function subscribeServerEvents(connection: Redis, onEvent: (event: WsServerEvent) => void): void {
  connection.subscribe(SERVER_EVENTS_CHANNEL);
  connection.on("message", (channel, message) => {
    if (channel !== SERVER_EVENTS_CHANNEL) return;
    try {
      onEvent(JSON.parse(message) as WsServerEvent);
    } catch {
      // ignore malformed payloads rather than crashing the subscriber
    }
  });
}
