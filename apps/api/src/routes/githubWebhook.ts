import { Elysia } from "elysia";
import { and, eq } from "drizzle-orm";
import { applications, deployments, githubInstallations } from "@yeah/db";
import { getGithubConfig, verifyWebhookSignature } from "@yeah/github";
import { db } from "../lib/db";
import { applicationDeployQueue } from "../lib/queue";
import { shouldSkipDeploy } from "../lib/deployRules";

interface GithubPushPayload {
  ref: string;
  repository: { full_name: string };
  installation?: { id: number };
  head_commit?: { message?: string } | null;
}

export const githubWebhookRoutes = new Elysia().post("/webhooks/github", async ({ request, set }) => {
  const config = getGithubConfig();
  if (!config) {
    set.status = 404;
    return { error: "not found" };
  }

  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");
  if (!verifyWebhookSignature(rawBody, signature, config.webhookSecret)) {
    set.status = 401;
    return { error: "invalid signature" };
  }

  const event = request.headers.get("x-github-event");
  if (event !== "push") return { ok: true, ignored: event };

  const payload = JSON.parse(rawBody) as GithubPushPayload;
  const installationId = payload.installation?.id;
  if (!installationId) return { ok: true, ignored: "no installation" };

  if (shouldSkipDeploy(payload.head_commit?.message)) return { ok: true, ignored: "skip marker in commit message" };

  const branch = payload.ref.replace("refs/heads/", "");
  if (branch === payload.ref) return { ok: true, ignored: "not a branch push" };

  const installationRows = await db
    .select()
    .from(githubInstallations)
    .where(eq(githubInstallations.installationId, installationId))
    .limit(1);
  if (!installationRows[0]) return { ok: true, ignored: "unknown installation" };

  const matches = await db
    .select()
    .from(applications)
    .where(
      and(
        eq(applications.githubInstallationId, installationId),
        eq(applications.githubRepo, payload.repository.full_name),
        eq(applications.branch, branch),
      ),
    );

  for (const application of matches) {
    const [deployment] = await db.insert(deployments).values({ applicationId: application.id, status: "queued" }).returning();
    if (deployment) await applicationDeployQueue.add("deploy", { deploymentId: deployment.id });
  }

  return { ok: true, triggered: matches.length };
});
