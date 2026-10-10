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
  createCloudflareTunnelWorker,
  createTrafficAnalyticsQueue,
  createTrafficAnalyticsWorker,
  createApplicationRoutingWorker,
  createApiTokenExpiryQueue,
  createApiTokenExpiryWorker,
  ensureApiTokenExpiryScheduler,
  ensureServerMetricsScheduler,
  ensureTlsCheckScheduler,
  ensureLogRetentionScheduler,
  ensureTrafficAnalyticsScheduler,
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
import { makeCloudflareTunnelProcessor } from "./jobs/cloudflareTunnel";
import { makeTrafficAnalyticsProcessor } from "./jobs/trafficAnalytics";
import { makeApplicationRoutingProcessor } from "./jobs/applicationRouting";
import { makeApiTokenExpiryProcessor } from "./jobs/apiTokenExpiry";
import { log, logJobEvents } from "./lib/logger";

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
const cloudflareTunnelConnection = createRedisConnection(redisUrl);
const trafficAnalyticsConnection = createRedisConnection(redisUrl);
const applicationRoutingConnection = createRedisConnection(redisUrl);
const apiTokenExpiryConnection = createRedisConnection(redisUrl);
const dockerCleanupConnection = createRedisConnection(redisUrl);
const caCertificateConnection = createRedisConnection(redisUrl);
const platformOperationJobConnection = createRedisConnection(redisUrl);

// Everything else here is a plain non-blocking command (PUBLISH, or BullMQ Queue calls like
// upsertJobScheduler/add) — those freely interleave on Redis regardless of who else is using the
// connection, so one shared connection covers every processor's publish side plus the two
// schedulers and the platform-operation self-queue, instead of 12 separate idle sockets.
const sharedConnection = createRedisConnection(redisUrl);

const serverCheckWorker = createServerCheckWorker(jobConnection, makeCheckServerProcessor(sharedConnection));
logJobEvents(serverCheckWorker, "server-check", true);

const deployWorker = createApplicationDeployWorker(
  deployJobConnection,
  makeDeployApplicationProcessor(sharedConnection),
);
logJobEvents(deployWorker, "application-deploy", true);

const lifecycleWorker = createApplicationLifecycleWorker(lifecycleJobConnection, makeLifecycleApplicationProcessor(sharedConnection));
logJobEvents(lifecycleWorker, "application-lifecycle");

const taskWorker = createScheduledTaskWorker(taskJobConnection, makeScheduledTaskProcessor());
logJobEvents(taskWorker, "scheduled-task");

const provisionWorker = createDatabaseProvisionWorker(
  provisionJobConnection,
  makeProvisionDatabaseProcessor(sharedConnection),
);
logJobEvents(provisionWorker, "database-provision", true);

const restoreWorker = createDatabaseRestoreWorker(restoreConnection, makeRestoreDatabaseProcessor());
logJobEvents(restoreWorker, "database-restore");

const volumeBackupWorker = createVolumeBackupWorker(volumeBackupConnection, makeVolumeBackupProcessor());
logJobEvents(volumeBackupWorker, "volume-backup");

const backupWorker = createDatabaseBackupWorker(
  backupJobConnection,
  makeBackupDatabaseProcessor(sharedConnection),
);
logJobEvents(backupWorker, "database-backup", true);

const proxyWorker = createProxyProvisionWorker(proxyJobConnection, makeProvisionProxyProcessor(sharedConnection));
logJobEvents(proxyWorker, "proxy-provision", true);

const serviceWorker = createServiceProvisionWorker(serviceJobConnection, makeProvisionServiceProcessor(sharedConnection));
logJobEvents(serviceWorker, "service-provision", true);

const metricsWorker = createServerMetricsWorker(metricsJobConnection, makeServerMetricsProcessor(sharedConnection));
logJobEvents(metricsWorker, "server-metrics");

const metricsSchedulerQueue = createServerMetricsQueue(sharedConnection);
await ensureServerMetricsScheduler(metricsSchedulerQueue);

const tlsWorker = createTlsCheckWorker(tlsJobConnection, makeTlsCheckProcessor());
logJobEvents(tlsWorker, "tls-check");

const tlsSchedulerQueue = createTlsCheckQueue(sharedConnection);
await ensureTlsCheckScheduler(tlsSchedulerQueue);

const logRetentionWorker = createLogRetentionWorker(logRetentionJobConnection, makeLogRetentionProcessor());
logJobEvents(logRetentionWorker, "log-retention");

const logRetentionSchedulerQueue = createLogRetentionQueue(sharedConnection);
await ensureLogRetentionScheduler(logRetentionSchedulerQueue);

const cloudflareTunnelWorker = createCloudflareTunnelWorker(cloudflareTunnelConnection, makeCloudflareTunnelProcessor());
logJobEvents(cloudflareTunnelWorker, "cloudflare-tunnel");

const trafficAnalyticsWorker = createTrafficAnalyticsWorker(trafficAnalyticsConnection, makeTrafficAnalyticsProcessor());
logJobEvents(trafficAnalyticsWorker, "traffic-analytics");

const trafficAnalyticsSchedulerQueue = createTrafficAnalyticsQueue(sharedConnection);
await ensureTrafficAnalyticsScheduler(trafficAnalyticsSchedulerQueue);

const applicationRoutingWorker = createApplicationRoutingWorker(applicationRoutingConnection, makeApplicationRoutingProcessor());
logJobEvents(applicationRoutingWorker, "application-routing");

const apiTokenExpiryWorker = createApiTokenExpiryWorker(apiTokenExpiryConnection, makeApiTokenExpiryProcessor());
logJobEvents(apiTokenExpiryWorker, "api-token-expiry");

const apiTokenExpirySchedulerQueue = createApiTokenExpiryQueue(sharedConnection);
await ensureApiTokenExpiryScheduler(apiTokenExpirySchedulerQueue);

const platformOperationSelfQueue = createPlatformOperationQueue(sharedConnection);
const platformOperationWorker = createPlatformOperationWorker(
  platformOperationJobConnection,
  makePlatformOperationProcessor(sharedConnection, platformOperationSelfQueue),
);
logJobEvents(platformOperationWorker, "platform-operation");

const dockerCleanupWorker = createDockerCleanupWorker(dockerCleanupConnection, makeDockerCleanupProcessor());
logJobEvents(dockerCleanupWorker, "docker-cleanup");

const caCertificateWorker = createCaCertificateWorker(caCertificateConnection, makeCaCertificateProcessor());
logJobEvents(caCertificateWorker, "ca-certificate");

log.info("listening for jobs", { queues: "server-check, application-deploy, application-lifecycle, scheduled-task, database-restore, volume-backup, database-provision, database-backup, proxy-provision, service-provision, server-metrics, tls-check, platform-operation, docker-cleanup, ca-certificate, log-retention, cloudflare-tunnel, traffic-analytics, application-routing and api-token-expiry jobs" });
