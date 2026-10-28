import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { healthRoutes } from "./routes/health";
import { authRoutes } from "./routes/auth";
import { passkeyRoutes } from "./routes/passkeys";
import { teamRoutes } from "./routes/teams";
import { serverRoutes } from "./routes/servers";
import { sshKeyRoutes } from "./routes/sshKeys";
import { caCertificateRoutes } from "./routes/caCertificates";
import { dockerCleanupRoutes } from "./routes/dockerCleanup";
import { serverOpsRoutes } from "./routes/serverOps";
import { auditRoutes } from "./routes/audit";
import { teamSecurityRoutes } from "./routes/teamSecurity";
import { applicationFilesRoutes } from "./routes/applicationFiles";
import { recordAuditFromRequest } from "./lib/audit";
import { storageRoutes } from "./routes/storages";
import { projectRoutes } from "./routes/projects";
import { applicationRoutes } from "./routes/applications";
import { applicationOpsRoutes } from "./routes/applicationOps";
import { volumeBackupRoutes } from "./routes/volumeBackups";
import { databaseRoutes } from "./routes/databases";
import { databaseBackupRoutes } from "./routes/databaseBackups";
import { githubRoutes } from "./routes/github";
import { githubWebhookRoutes } from "./routes/githubWebhook";
import { notificationRoutes } from "./routes/notifications";
import { logDrainRoutes } from "./routes/logDrains";
import { serviceRoutes } from "./routes/services";
import { serviceVolumeBackupRoutes } from "./routes/serviceVolumeBackups";
import { updateRoutes } from "./routes/updates";
import { searchRoutes } from "./routes/search";
import { deployHookRoutes } from "./routes/deployHook";
import { sharedVariableRoutes } from "./routes/sharedVariables";
import { tagRoutes } from "./routes/tags";
import { registryRoutes } from "./routes/registries";
import { serviceTemplateRoutes } from "./routes/serviceTemplates";
import { gitSourceRoutes } from "./routes/gitSources";
import { gitSourceWebhookRoutes } from "./routes/gitSourceWebhook";
import { terminalRoutes } from "./routes/terminal";
import { ciRoutes, apiV1Routes } from "./routes/ci";
import { buildOpenApiSpec, SWAGGER_HTML } from "./lib/openapi";
import { mcpRoutes } from "./routes/mcp";
import { apiTokenRoutes } from "./routes/apiTokens";
import { encryptExistingSecrets } from "@yeah/db";
import { db } from "./lib/db";
import { clientIp, RateLimiter, ruleFor } from "./lib/rateLimit";
import { createLogger, parseLogLevel } from "@yeah/shared";

const port = process.env.API_PORT ? Number(process.env.API_PORT) : 3000;

// Credentialed cookies mean the origin list must be explicit — "*" is rejected by browsers here.
const webOrigins = (process.env.WEB_ORIGIN ?? "http://localhost:5173,http://localhost:5174")
  .split(",")
  .map((origin) => origin.trim());

const limiter = new RateLimiter();

const log = createLogger("api", {
  format: process.env.LOG_FORMAT === "text" ? "text" : "json",
  minLevel: parseLogLevel(process.env.LOG_LEVEL),
});
// Correlates the onRequest/onAfterResponse/onError hooks of one request without touching Elysia's store typing.
const requests = new WeakMap<Request, { id: string; start: number }>();

const app = new Elysia()
  .onRequest(({ request, set }) => {
    const id = request.headers.get("x-request-id")?.slice(0, 64) || crypto.randomUUID();
    requests.set(request, { id, start: performance.now() });
    set.headers["x-request-id"] = id;
  })
  .onAfterResponse(({ request, set, cookie }) => {
    void recordAuditFromRequest(request, Number(set.status ?? 200), cookie);
    const info = requests.get(request);
    const path = new URL(request.url).pathname;
    if (!info || path.endsWith("/health")) return;
    log.info("request", { requestId: info.id, method: request.method, path, status: Number(set.status ?? 200), ms: Math.round(performance.now() - info.start) });
  })
  .onError(({ request, error }) => {
    const info = requests.get(request);
    log.error("unhandled error", { requestId: info?.id, method: request.method, path: new URL(request.url).pathname, err: error });
  })
  .onRequest(({ request, server }) => {
    const rule = ruleFor(request.method, new URL(request.url).pathname);
    if (!rule) return;
    const result = limiter.hit(clientIp(request.headers, server?.requestIP(request)?.address), rule);
    if (result.allowed) return;
    return new Response(JSON.stringify({ error: "muitas requisições — tente de novo em instantes" }), {
      status: 429,
      headers: {
        "content-type": "application/json",
        "retry-after": String(result.retryAfterSec),
        "access-control-allow-origin": request.headers.get("origin") ?? "",
        "access-control-allow-credentials": "true",
        "access-control-expose-headers": "retry-after",
      },
    });
  })
  .use(cors({ origin: webOrigins, credentials: true }))
  .use(healthRoutes)
  .use(authRoutes)
  .use(passkeyRoutes)
  .use(teamRoutes)
  .use(serverRoutes)
  .use(sshKeyRoutes)
  .use(caCertificateRoutes)
  .use(dockerCleanupRoutes)
  .use(serverOpsRoutes)
  .use(auditRoutes)
  .use(teamSecurityRoutes)
  .use(storageRoutes)
  .use(projectRoutes)
  .use(applicationRoutes)
  .use(applicationOpsRoutes)
  .use(applicationFilesRoutes)
  .use(volumeBackupRoutes)
  .use(databaseRoutes)
  .use(databaseBackupRoutes)
  .use(githubRoutes)
  .use(githubWebhookRoutes)
  .use(notificationRoutes)
  .use(logDrainRoutes)
  .use(serviceRoutes)
  .use(serviceVolumeBackupRoutes)
  .use(updateRoutes)
  .use(searchRoutes)
  .use(deployHookRoutes)
  .use(sharedVariableRoutes)
  .use(tagRoutes)
  .use(registryRoutes)
  .use(serviceTemplateRoutes)
  .use(gitSourceRoutes)
  .use(gitSourceWebhookRoutes)
  .use(terminalRoutes)
  .use(ciRoutes)
  .use(apiV1Routes)
  .get("/api/v1/openapi.json", () => buildOpenApiSpec())
  .get("/swagger", ({ set }) => {
    set.headers["content-type"] = "text/html; charset=utf-8";
    return SWAGGER_HTML;
  })
  .use(apiTokenRoutes)
  .use(mcpRoutes)
  .listen(port);

// Secrets written before encryption-at-rest existed get rewritten encrypted on the next start.
encryptExistingSecrets(db)
  .then((count) => {
    if (count > 0) log.info("encrypted plaintext secrets at rest", { count });
  })
  .catch((err) => log.error("encrypting existing secrets failed", { err }));

log.info("listening", { port });

export type App = typeof app;
