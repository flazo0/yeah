import {
  createApplicationDeployWorker,
  createApplicationLifecycleWorker,
  createScheduledTaskWorker,
  createDatabaseBackupWorker,
  createDatabaseProvisionWorker,
  createPlatformOperationQueue,
  createPlatformOperationWorker,
  createProxyProvisionWorker,
  createRedisConnection,
  createServerCheckWorker,
  createServiceProvisionWorker,
  createServerMetricsQueue,
  createServerMetricsWorker,
  createTlsCheckQueue,
  createTlsCheckWorker,
  ensureServerMetricsScheduler,
  ensureTlsCheckScheduler,
} from "@yeah/queue";
import { makeCheckServerProcessor } from "./jobs/checkServer";
import { makeDeployApplicationProcessor } from "./jobs/deployApplication";
import { makeLifecycleApplicationProcessor } from "./jobs/lifecycleApplication";
import { makeScheduledTaskProcessor } from "./jobs/scheduledTask";
import { makeProvisionDatabaseProcessor } from "./jobs/provisionDatabase";
import { makeBackupDatabaseProcessor } from "./jobs/backupDatabase";
import { makeProvisionProxyProcessor } from "./jobs/provisionProxy";
import { makeProvisionServiceProcessor } from "./jobs/provisionService";
import { makePlatformOperationProcessor } from "./jobs/platformOperation";
import { makeServerMetricsProcessor } from "./jobs/serverMetrics";
import { makeTlsCheckProcessor } from "./jobs/tlsCheck";

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  throw new Error("REDIS_URL is not set");
}

const jobConnection = createRedisConnection(redisUrl);
const publishConnection = createRedisConnection(redisUrl);
const deployJobConnection = createRedisConnection(redisUrl);
const deployPublishConnection = createRedisConnection(redisUrl);
const lifecycleJobConnection = createRedisConnection(redisUrl);
const lifecyclePublishConnection = createRedisConnection(redisUrl);
const taskJobConnection = createRedisConnection(redisUrl);
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
const tlsJobConnection = createRedisConnection(redisUrl);
const tlsSchedulerConnection = createRedisConnection(redisUrl);
const platformOperationJobConnection = createRedisConnection(redisUrl);
const platformOperationPublishConnection = createRedisConnection(redisUrl);
const platformOperationSelfQueueConnection = createRedisConnection(redisUrl);

const serverCheckWorker = createServerCheckWorker(jobConnection, makeCheckServerProcessor(publishConnection));
serverCheckWorker.on("completed", (job) => console.log(`[worker] server-check ${job.id} completed`));
serverCheckWorker.on("failed", (job, err) => console.error(`[worker] server-check ${job?.id} failed:`, err.message));

const deployWorker = createApplicationDeployWorker(
  deployJobConnection,
  makeDeployApplicationProcessor(deployPublishConnection),
);
deployWorker.on("completed", (job) => console.log(`[worker] application-deploy ${job.id} completed`));
deployWorker.on("failed", (job, err) => console.error(`[worker] application-deploy ${job?.id} failed:`, err.message));

const lifecycleWorker = createApplicationLifecycleWorker(lifecycleJobConnection, makeLifecycleApplicationProcessor(lifecyclePublishConnection));
lifecycleWorker.on("failed", (job, err) => console.error(`[worker] application-lifecycle ${job?.id} failed:`, err.message));

const taskWorker = createScheduledTaskWorker(taskJobConnection, makeScheduledTaskProcessor());
taskWorker.on("failed", (job, err) => console.error(`[worker] scheduled-task ${job?.id} failed:`, err.message));

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

const tlsWorker = createTlsCheckWorker(tlsJobConnection, makeTlsCheckProcessor());
tlsWorker.on("failed", (job, err) => console.error(`[worker] tls-check ${job?.id} failed:`, err.message));

const tlsSchedulerQueue = createTlsCheckQueue(tlsSchedulerConnection);
await ensureTlsCheckScheduler(tlsSchedulerQueue);

const platformOperationSelfQueue = createPlatformOperationQueue(platformOperationSelfQueueConnection);
const platformOperationWorker = createPlatformOperationWorker(
  platformOperationJobConnection,
  makePlatformOperationProcessor(platformOperationPublishConnection, platformOperationSelfQueue),
);
platformOperationWorker.on("failed", (job, err) => console.error(`[worker] platform-operation ${job?.id} failed:`, err.message));

console.log(
  "[worker] listening for server-check, application-deploy, application-lifecycle, scheduled-task, database-provision, database-backup, proxy-provision, service-provision, server-metrics, tls-check and platform-operation jobs",
);
