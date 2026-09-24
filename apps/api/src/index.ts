import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { healthRoutes } from "./routes/health";
import { authRoutes } from "./routes/auth";
import { teamRoutes } from "./routes/teams";
import { serverRoutes } from "./routes/servers";
import { storageRoutes } from "./routes/storages";
import { projectRoutes } from "./routes/projects";
import { applicationRoutes } from "./routes/applications";
import { applicationOpsRoutes } from "./routes/applicationOps";
import { databaseRoutes } from "./routes/databases";
import { githubRoutes } from "./routes/github";
import { githubWebhookRoutes } from "./routes/githubWebhook";
import { notificationRoutes } from "./routes/notifications";
import { serviceRoutes } from "./routes/services";
import { updateRoutes } from "./routes/updates";
import { searchRoutes } from "./routes/search";
import { deployHookRoutes } from "./routes/deployHook";
import { sharedVariableRoutes } from "./routes/sharedVariables";
import { tagRoutes } from "./routes/tags";
import { registryRoutes } from "./routes/registries";
import { terminalRoutes } from "./routes/terminal";
import { encryptExistingSecrets } from "@yeah/db";
import { db } from "./lib/db";
import { clientIp, RateLimiter, ruleFor } from "./lib/rateLimit";

const port = process.env.API_PORT ? Number(process.env.API_PORT) : 3000;

// Credentialed cookies mean the origin list must be explicit — "*" is rejected by browsers here.
const webOrigins = (process.env.WEB_ORIGIN ?? "http://localhost:5173,http://localhost:5174")
  .split(",")
  .map((origin) => origin.trim());

const limiter = new RateLimiter();

const app = new Elysia()
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
  .use(teamRoutes)
  .use(serverRoutes)
  .use(storageRoutes)
  .use(projectRoutes)
  .use(applicationRoutes)
  .use(applicationOpsRoutes)
  .use(databaseRoutes)
  .use(githubRoutes)
  .use(githubWebhookRoutes)
  .use(notificationRoutes)
  .use(serviceRoutes)
  .use(updateRoutes)
  .use(searchRoutes)
  .use(deployHookRoutes)
  .use(sharedVariableRoutes)
  .use(tagRoutes)
  .use(registryRoutes)
  .use(terminalRoutes)
  .listen(port);

// Secrets written before encryption-at-rest existed get rewritten encrypted on the next start.
encryptExistingSecrets(db)
  .then((count) => {
    if (count > 0) console.log(`[api] encrypted ${count} plaintext secret(s) at rest`);
  })
  .catch((err) => console.error("[api] encrypting existing secrets failed:", err instanceof Error ? err.message : err));

console.log(`[api] listening on http://localhost:${port}`);

export type App = typeof app;
