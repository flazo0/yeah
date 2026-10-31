import { Elysia } from "elysia";
import { and, eq, isNull } from "drizzle-orm";
import { applications, deployments, gitSources } from "@yeah/db";
import { db } from "../lib/db";
import { applicationDeployQueue } from "../lib/queue";
import { shouldSkipDeploy } from "../lib/deployRules";
import { parseGitPush, verifyGitWebhook } from "../lib/gitWebhooks";

// One endpoint per source: /webhooks/git/<source id>. The provider proves itself with the source's own
// secret, so a leaked URL alone cannot trigger deploys, and one source's secret is useless on another.
export const gitSourceWebhookRoutes = new Elysia().post("/webhooks/git/:sourceId", async ({ request, params, set }) => {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const [source] = uuid.test(params.sourceId) ? await db.select().from(gitSources).where(eq(gitSources.id, params.sourceId)).limit(1) : [];
  // Same answer for "no such source" and "bad secret": the endpoint does not confirm which ids exist.
  const rawBody = await request.text();
  if (!source || !verifyGitWebhook(source.provider, request.headers, rawBody, source.webhookSecret)) {
    set.status = 401;
    return { error: "invalid signature" };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { ok: true, ignored: "not json" };
  }
  const push = parseGitPush(source.provider, request.headers, payload);
  if (!push) return { ok: true, ignored: "not a branch push" };

  let triggered = 0;
  for (const { branch, message } of push.branches) {
    if (shouldSkipDeploy(message)) continue;
    const matches = await db
      .select()
      .from(applications)
      .where(and(eq(applications.gitSourceId, source.id), eq(applications.gitRepo, push.repo), eq(applications.branch, branch), isNull(applications.previewOfId)));
    for (const application of matches) {
      const [deployment] = await db.insert(deployments).values({ applicationId: application.id, status: "queued" }).returning();
      if (deployment) {
        await applicationDeployQueue.add("deploy", { deploymentId: deployment.id });
        triggered++;
      }
    }
  }
  return { ok: true, triggered };
});
