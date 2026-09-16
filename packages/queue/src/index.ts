import Redis from "ioredis";
import { Queue, Worker, type Processor } from "bullmq";
import type { WsServerEvent } from "@yeah/shared";

export const SERVER_CHECK_QUEUE = "server-check";
export const APPLICATION_DEPLOY_QUEUE = "application-deploy";
export const DATABASE_PROVISION_QUEUE = "database-provision";
export const DATABASE_BACKUP_QUEUE = "database-backup";
export const PROXY_PROVISION_QUEUE = "proxy-provision";
export const SERVER_EVENTS_CHANNEL = "server-events";

export interface ServerCheckJobData {
  serverId: string;
}

export interface ApplicationDeployJobData {
  deploymentId: string;
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
