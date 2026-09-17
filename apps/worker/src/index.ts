import {
  createApplicationDeployWorker,
  createDatabaseBackupWorker,
  createDatabaseProvisionWorker,
  createProxyProvisionWorker,
  createRedisConnection,
  createServerCheckWorker,
  createServiceProvisionWorker,
  createServerMetricsQueue,
  createServerMetricsWorker,
  ensureServerMetricsScheduler,
} from "@yeah/queue";
import { makeCheckServerProcessor } from "./jobs/checkServer";
import { makeDeployApplicationProcessor } from "./jobs/deployApplication";
import { makeProvisionDatabaseProcessor } from "./jobs/provisionDatabase";
import { makeBackupDatabaseProcessor } from "./jobs/backupDatabase";
import { makeProvisionProxyProcessor } from "./jobs/provisionProxy";
import { makeProvisionServiceProcessor } from "./jobs/provisionService";
import { makeServerMetricsProcessor } from "./jobs/serverMetrics";

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  throw new Error("REDIS_URL is not set");
}

const jobConnection = createRedisConnection(redisUrl);
const publishConnection = createRedisConnection(redisUrl);
const deployJobConnection = createRedisConnection(redisUrl);
const deployPublishConnection = createRedisConnection(redisUrl);
const provisionJobConnection = createRedisConnection(redisUrl);
const provisionPublishConnection = createRedisConnection(redisUrl);
const backupJobConnection = createRedisConnection(redisUrl);
const backupPublishConnection = createRedisConnection(redisUrl);
const proxyJobConnection = createRedisConnection(redisUrl);
const proxyPublishConnection = createRedisConnection(redisUrl);
const serviceJobConnection = createRedisConnection(redisUrl);
const servicePublishConnection = createRedisConnection(redisUrl);
const metricsJobConnection = createRedisConnection(redisUrl);
const metricsPublishConnection = createRedisConnection(redisUrl);
const metricsSchedulerConnection = createRedisConnection(redisUrl);

const serverCheckWorker = createServerCheckWorker(jobConnection, makeCheckServerProcessor(publishConnection));
serverCheckWorker.on("completed", (job) => console.log(`[worker] server-check ${job.id} completed`));
serverCheckWorker.on("failed", (job, err) => console.error(`[worker] server-check ${job?.id} failed:`, err.message));

const deployWorker = createApplicationDeployWorker(
  deployJobConnection,
  makeDeployApplicationProcessor(deployPublishConnection),
);
deployWorker.on("completed", (job) => console.log(`[worker] application-deploy ${job.id} completed`));
deployWorker.on("failed", (job, err) => console.error(`[worker] application-deploy ${job?.id} failed:`, err.message));

const provisionWorker = createDatabaseProvisionWorker(
  provisionJobConnection,
  makeProvisionDatabaseProcessor(provisionPublishConnection),
);
provisionWorker.on("completed", (job) => console.log(`[worker] database-provision ${job.id} completed`));
provisionWorker.on("failed", (job, err) => console.error(`[worker] database-provision ${job?.id} failed:`, err.message));

const backupWorker = createDatabaseBackupWorker(
  backupJobConnection,
  makeBackupDatabaseProcessor(backupPublishConnection),
);
backupWorker.on("completed", (job) => console.log(`[worker] database-backup ${job.id} completed`));
backupWorker.on("failed", (job, err) => console.error(`[worker] database-backup ${job?.id} failed:`, err.message));

const proxyWorker = createProxyProvisionWorker(proxyJobConnection, makeProvisionProxyProcessor(proxyPublishConnection));
proxyWorker.on("completed", (job) => console.log(`[worker] proxy-provision ${job.id} completed`));
proxyWorker.on("failed", (job, err) => console.error(`[worker] proxy-provision ${job?.id} failed:`, err.message));

const serviceWorker = createServiceProvisionWorker(serviceJobConnection, makeProvisionServiceProcessor(servicePublishConnection));
serviceWorker.on("completed", (job) => console.log(`[worker] service-provision ${job.id} completed`));
serviceWorker.on("failed", (job, err) => console.error(`[worker] service-provision ${job?.id} failed:`, err.message));

const metricsWorker = createServerMetricsWorker(metricsJobConnection, makeServerMetricsProcessor(metricsPublishConnection));
metricsWorker.on("failed", (job, err) => console.error(`[worker] server-metrics ${job?.id} failed:`, err.message));

const metricsSchedulerQueue = createServerMetricsQueue(metricsSchedulerConnection);
await ensureServerMetricsScheduler(metricsSchedulerQueue);

console.log(
  "[worker] listening for server-check, application-deploy, database-provision, database-backup, proxy-provision, service-provision and server-metrics jobs",
);
