import {
  createApplicationDeployWorker,
  createApplicationLifecycleWorker,
  createScheduledTaskWorker,
  createDatabaseBackupWorker,
  createDatabaseRestoreWorker,
  createVolumeBackupWorker,
  createDatabaseProvisionWorker,
  createDockerCleanupWorker,
  createCaCertificateWorker,
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
  createLogRetentionQueue,
  createLogRetentionWorker,
  ensureServerMetricsScheduler,
  ensureTlsCheckScheduler,
  ensureLogRetentionScheduler,
} from "@yeah/queue";
import { makeCheckServerProcessor } from "./jobs/checkServer";
import { makeDeployApplicationProcessor } from "./jobs/deployApplication";
import { makeLifecycleApplicationProcessor } from "./jobs/lifecycleApplication";
import { makeScheduledTaskProcessor } from "./jobs/scheduledTask";
import { makeProvisionDatabaseProcessor } from "./jobs/provisionDatabase";
import { makeBackupDatabaseProcessor } from "./jobs/backupDatabase";
import { makeRestoreDatabaseProcessor } from "./jobs/restoreDatabase";
import { makeVolumeBackupProcessor } from "./jobs/volumeBackup";
import { makeProvisionProxyProcessor } from "./jobs/provisionProxy";
import { makeDockerCleanupProcessor } from "./jobs/dockerCleanup";
import { makeCaCertificateProcessor } from "./jobs/caCertificate";
import { makeProvisionServiceProcessor } from "./jobs/provisionService";
import { makePlatformOperationProcessor } from "./jobs/platformOperation";
import { makeServerMetricsProcessor } from "./jobs/serverMetrics";
import { makeTlsCheckProcessor } from "./jobs/tlsCheck";
import { makeLogRetentionProcessor } from "./jobs/logRetention";

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  throw new Error("REDIS_URL is not set");
}

// Each BullMQ Worker needs its own dedicated connection (it issues blocking commands to wait for
// jobs, which would stall any other command sharing that connection) — these 15 stay separate.
const jobConnection = createRedisConnection(redisUrl);
const deployJobConnection = createRedisConnection(redisUrl);
const lifecycleJobConnection = createRedisConnection(redisUrl);
const taskJobConnection = createRedisConnection(redisUrl);
const provisionJobConnection = createRedisConnection(redisUrl);
const restoreConnection = createRedisConnection(redisUrl);
const volumeBackupConnection = createRedisConnection(redisUrl);
const backupJobConnection = createRedisConnection(redisUrl);
const proxyJobConnection = createRedisConnection(redisUrl);
const serviceJobConnection = createRedisConnection(redisUrl);
const metricsJobConnection = createRedisConnection(redisUrl);
const tlsJobConnection = createRedisConnection(redisUrl);
const logRetentionJobConnection = createRedisConnection(redisUrl);
const dockerCleanupConnection = createRedisConnection(redisUrl);
const caCertificateConnection = createRedisConnection(redisUrl);
const platformOperationJobConnection = createRedisConnection(redisUrl);

// Everything else here is a plain non-blocking command (PUBLISH, or BullMQ Queue calls like
// upsertJobScheduler/add) — those freely interleave on Redis regardless of who else is using the
// connection, so one shared connection covers every processor's publish side plus the two
// schedulers and the platform-operation self-queue, instead of 12 separate idle sockets.
const sharedConnection = createRedisConnection(redisUrl);

const serverCheckWorker = createServerCheckWorker(jobConnection, makeCheckServerProcessor(sharedConnection));
serverCheckWorker.on("completed", (job) => console.log(`[worker] server-check ${job.id} completed`));
serverCheckWorker.on("failed", (job, err) => console.error(`[worker] server-check ${job?.id} failed:`, err.message));

const deployWorker = createApplicationDeployWorker(
  deployJobConnection,
  makeDeployApplicationProcessor(sharedConnection),
);
deployWorker.on("completed", (job) => console.log(`[worker] application-deploy ${job.id} completed`));
deployWorker.on("failed", (job, err) => console.error(`[worker] application-deploy ${job?.id} failed:`, err.message));

const lifecycleWorker = createApplicationLifecycleWorker(lifecycleJobConnection, makeLifecycleApplicationProcessor(sharedConnection));
lifecycleWorker.on("failed", (job, err) => console.error(`[worker] application-lifecycle ${job?.id} failed:`, err.message));

const taskWorker = createScheduledTaskWorker(taskJobConnection, makeScheduledTaskProcessor());
taskWorker.on("failed", (job, err) => console.error(`[worker] scheduled-task ${job?.id} failed:`, err.message));

const provisionWorker = createDatabaseProvisionWorker(
  provisionJobConnection,
  makeProvisionDatabaseProcessor(sharedConnection),
);
provisionWorker.on("completed", (job) => console.log(`[worker] database-provision ${job.id} completed`));
provisionWorker.on("failed", (job, err) => console.error(`[worker] database-provision ${job?.id} failed:`, err.message));

const restoreWorker = createDatabaseRestoreWorker(restoreConnection, makeRestoreDatabaseProcessor());
restoreWorker.on("failed", (job, err) => console.error(`[worker] database-restore ${job?.id} failed:`, err.message));

const volumeBackupWorker = createVolumeBackupWorker(volumeBackupConnection, makeVolumeBackupProcessor());
volumeBackupWorker.on("failed", (job, err) => console.error(`[worker] volume-backup ${job?.id} failed:`, err.message));

const backupWorker = createDatabaseBackupWorker(
  backupJobConnection,
  makeBackupDatabaseProcessor(sharedConnection),
);
backupWorker.on("completed", (job) => console.log(`[worker] database-backup ${job.id} completed`));
backupWorker.on("failed", (job, err) => console.error(`[worker] database-backup ${job?.id} failed:`, err.message));

const proxyWorker = createProxyProvisionWorker(proxyJobConnection, makeProvisionProxyProcessor(sharedConnection));
proxyWorker.on("completed", (job) => console.log(`[worker] proxy-provision ${job.id} completed`));
proxyWorker.on("failed", (job, err) => console.error(`[worker] proxy-provision ${job?.id} failed:`, err.message));

const serviceWorker = createServiceProvisionWorker(serviceJobConnection, makeProvisionServiceProcessor(sharedConnection));
serviceWorker.on("completed", (job) => console.log(`[worker] service-provision ${job.id} completed`));
serviceWorker.on("failed", (job, err) => console.error(`[worker] service-provision ${job?.id} failed:`, err.message));

const metricsWorker = createServerMetricsWorker(metricsJobConnection, makeServerMetricsProcessor(sharedConnection));
metricsWorker.on("failed", (job, err) => console.error(`[worker] server-metrics ${job?.id} failed:`, err.message));

const metricsSchedulerQueue = createServerMetricsQueue(sharedConnection);
await ensureServerMetricsScheduler(metricsSchedulerQueue);

const tlsWorker = createTlsCheckWorker(tlsJobConnection, makeTlsCheckProcessor());
tlsWorker.on("failed", (job, err) => console.error(`[worker] tls-check ${job?.id} failed:`, err.message));

const tlsSchedulerQueue = createTlsCheckQueue(sharedConnection);
await ensureTlsCheckScheduler(tlsSchedulerQueue);

const logRetentionWorker = createLogRetentionWorker(logRetentionJobConnection, makeLogRetentionProcessor());
logRetentionWorker.on("failed", (job, err) => console.error(`[worker] log-retention ${job?.id} failed:`, err.message));

const logRetentionSchedulerQueue = createLogRetentionQueue(sharedConnection);
await ensureLogRetentionScheduler(logRetentionSchedulerQueue);

const platformOperationSelfQueue = createPlatformOperationQueue(sharedConnection);
const platformOperationWorker = createPlatformOperationWorker(
  platformOperationJobConnection,
  makePlatformOperationProcessor(sharedConnection, platformOperationSelfQueue),
);
platformOperationWorker.on("failed", (job, err) => console.error(`[worker] platform-operation ${job?.id} failed:`, err.message));

const dockerCleanupWorker = createDockerCleanupWorker(dockerCleanupConnection, makeDockerCleanupProcessor());
dockerCleanupWorker.on("failed", (job, err) => console.error(`[worker] docker-cleanup ${job?.id} failed:`, err.message));

const caCertificateWorker = createCaCertificateWorker(caCertificateConnection, makeCaCertificateProcessor());
caCertificateWorker.on("failed", (job, err) => console.error(`[worker] ca-certificate ${job?.id} failed:`, err.message));

console.log(
  "[worker] listening for server-check, application-deploy, application-lifecycle, scheduled-task, database-restore, volume-backup, database-provision, database-backup, proxy-provision, service-provision, server-metrics, tls-check, platform-operation, docker-cleanup, ca-certificate and log-retention jobs",
);
