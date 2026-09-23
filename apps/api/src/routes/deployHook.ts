import { Elysia } from "elysia";
import { eq } from "drizzle-orm";
import { applications, deployments } from "@yeah/db";
import { db } from "../lib/db";
import { applicationDeployQueue } from "../lib/queue";
import { hashDeployToken } from "../lib/deployRules";

// Unauthenticated on purpose: the token in the URL is the credential (CI systems, curl in a git hook).
// Only its sha256 is stored, and the global write rate limiter (lib/rateLimit.ts) applies to POSTs.
export const deployHookRoutes = new Elysia().post("/hooks/deploy/:token", async ({ params, set }) => {
  const [application] = await db
    .select()
    .from(applications)
    .where(eq(applications.deployTokenHash, hashDeployToken(params.token)))
    .limit(1);
  if (!application) {
    set.status = 404;
    return { error: "not found" };
  }
  if (application.status === "deploying") {
    set.status = 409;
    return { error: "já tem um deploy em andamento" };
  }

  const [deployment] = await db.insert(deployments).values({ applicationId: application.id, status: "queued" }).returning();
  if (!deployment) {
    set.status = 500;
    return { error: "failed to create deployment" };
  }
  await applicationDeployQueue.add("deploy", { deploymentId: deployment.id });
  return { ok: true, deploymentId: deployment.id };
});
