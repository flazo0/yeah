import { and, eq } from "drizzle-orm";
import { applications, applicationVolumes, deployments, servers } from "@yeah/db";
import { previewDomain, previewName, type PullRequestEvent } from "@yeah/shared";
import { db } from "./db";
import { applicationDeployQueue } from "./queue";
import { tearDownApplication } from "./appTeardown";
import { applicationCopyValues } from "./appCopy";

export interface PreviewResult {
  parent: string;
  action: "deployed" | "removed" | "skipped";
  reason?: string;
  previewId?: string;
}

/**
 * Applies one pull_request event to every opted-in application of that repository whose branch is the
 * PR's base: opened/reopened/synchronize (re)deploys a preview built from the PR branch, closed removes it.
 * Fork PRs are ignored — running someone else's code next to the parent app's env vars is not safe.
 */
export async function handlePullRequestEvent(pr: PullRequestEvent): Promise<PreviewResult[]> {
  if (pr.fromFork || pr.installationId === null) return [];
  const parents = await db
    .select()
    .from(applications)
    .where(
      and(
        eq(applications.githubInstallationId, pr.installationId),
        eq(applications.githubRepo, pr.repo),
        eq(applications.branch, pr.baseRef),
        eq(applications.previewEnabled, true),
      ),
    );

  const results: PreviewResult[] = [];
  for (const parent of parents) {
    const [existing] = await db
      .select()
      .from(applications)
      .where(and(eq(applications.previewOfId, parent.id), eq(applications.prNumber, pr.number)))
      .limit(1);
    const [server] = await db.select().from(servers).where(eq(servers.id, parent.serverId)).limit(1);

    if (pr.action === "closed") {
      if (!existing) {
        results.push({ parent: parent.id, action: "skipped", reason: "no preview" });
        continue;
      }
      const volumes = await db.select().from(applicationVolumes).where(eq(applicationVolumes.applicationId, existing.id));
      // Off the request path: GitHub gives a webhook about ten seconds to answer.
      if (server) {
        void tearDownApplication(existing, server, volumes).then((failure) => {
          if (failure) console.error(`[api] failed to tear down preview ${existing.id}: ${failure}`);
        });
      }
      await db.delete(applications).where(eq(applications.id, existing.id));
      results.push({ parent: parent.id, action: "removed", previewId: existing.id });
      continue;
    }

    if (!server || server.proxyStatus !== "active" || !server.wildcardDomain) {
      results.push({ parent: parent.id, action: "skipped", reason: "the server needs an active proxy and a wildcard domain" });
      continue;
    }

    let preview = existing;
    if (preview) {
      // Same PR, new commits (or the head branch was renamed): keep the row, point it at the branch.
      [preview] = await db.update(applications).set({ branch: pr.headRef }).where(eq(applications.id, preview.id)).returning();
    } else {
      [preview] = await db
        .insert(applications)
        .values(
          applicationCopyValues(parent, {
            name: previewName(parent.name, pr.number),
            branch: pr.headRef,
            domain: previewDomain(parent.name, pr.number, server.wildcardDomain),
            previewOfId: parent.id,
            prNumber: pr.number,
          }),
        )
        .returning();
      if (preview) {
        // New rows get new ids, so the copies are new docker volumes: the preview never touches the parent's data.
        const volumes = await db.select().from(applicationVolumes).where(eq(applicationVolumes.applicationId, parent.id));
        if (volumes.length) await db.insert(applicationVolumes).values(volumes.map((v) => ({ applicationId: preview!.id, name: v.name, mountPath: v.mountPath })));
      }
    }
    if (!preview) continue;

    const [deployment] = await db.insert(deployments).values({ applicationId: preview.id, status: "queued" }).returning();
    if (deployment) await applicationDeployQueue.add("deploy", { deploymentId: deployment.id });
    results.push({ parent: parent.id, action: "deployed", previewId: preview.id });
  }
  return results;
}
