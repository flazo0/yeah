import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { healthRoutes } from "./routes/health";
import { authRoutes } from "./routes/auth";
import { teamRoutes } from "./routes/teams";
import { serverRoutes } from "./routes/servers";
import { storageRoutes } from "./routes/storages";
import { projectRoutes } from "./routes/projects";
import { applicationRoutes } from "./routes/applications";
import { databaseRoutes } from "./routes/databases";
import { githubRoutes } from "./routes/github";
import { githubWebhookRoutes } from "./routes/githubWebhook";
import { notificationRoutes } from "./routes/notifications";
import { serviceRoutes } from "./routes/services";
import { updateRoutes } from "./routes/updates";

const port = process.env.API_PORT ? Number(process.env.API_PORT) : 3000;

// Credentialed cookies mean the origin list must be explicit — "*" is rejected by browsers here.
const webOrigins = (process.env.WEB_ORIGIN ?? "http://localhost:5173,http://localhost:5174")
  .split(",")
  .map((origin) => origin.trim());

const app = new Elysia()
  .use(cors({ origin: webOrigins, credentials: true }))
  .use(healthRoutes)
  .use(authRoutes)
  .use(teamRoutes)
  .use(serverRoutes)
  .use(storageRoutes)
  .use(projectRoutes)
  .use(applicationRoutes)
  .use(databaseRoutes)
  .use(githubRoutes)
  .use(githubWebhookRoutes)
  .use(notificationRoutes)
  .use(serviceRoutes)
  .use(updateRoutes)
  .listen(port);

console.log(`[api] listening on http://localhost:${port}`);

export type App = typeof app;
