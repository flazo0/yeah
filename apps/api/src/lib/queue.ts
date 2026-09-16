import {
  createApplicationDeployQueue,
  createDatabaseBackupQueue,
  createDatabaseProvisionQueue,
  createProxyProvisionQueue,
  createRedisConnection,
  createServerCheckQueue,
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
