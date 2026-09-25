import {
  createApplicationDeployQueue,
  createApplicationLifecycleQueue,
  createDatabaseBackupQueue,
  createDatabaseProvisionQueue,
  createPlatformOperationQueue,
  createProxyProvisionQueue,
  createRedisConnection,
  createScheduledTaskQueue,
  createDatabaseRestoreQueue,
  createVolumeBackupQueue,
  createServerCheckQueue,
  createServiceProvisionQueue,
} from "@yeah/queue";

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  throw new Error("REDIS_URL is not set");
}

const connection = createRedisConnection(redisUrl);

export const serverCheckQueue = createServerCheckQueue(connection);
export const applicationDeployQueue = createApplicationDeployQueue(connection);
export const databaseProvisionQueue = createDatabaseProvisionQueue(connection);
export const databaseBackupQueue = createDatabaseBackupQueue(connection);
export const proxyProvisionQueue = createProxyProvisionQueue(connection);
export const serviceProvisionQueue = createServiceProvisionQueue(connection);
export const platformOperationQueue = createPlatformOperationQueue(connection);
export const applicationLifecycleQueue = createApplicationLifecycleQueue(connection);
export const scheduledTaskQueue = createScheduledTaskQueue(connection);
export const databaseRestoreQueue = createDatabaseRestoreQueue(connection);
export const volumeBackupQueue = createVolumeBackupQueue(connection);
