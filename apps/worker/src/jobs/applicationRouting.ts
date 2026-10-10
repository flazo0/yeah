import { eq } from "drizzle-orm";
import { applications, servers } from "@yeah/db";
import { connectSsh } from "@yeah/ssh";
import { writeAppRouting } from "../lib/appRouting";
import type { ApplicationRoutingJobData } from "@yeah/queue";
import type { Job } from "bullmq";
import { db } from "../lib/db";

/**
 * Updates only the Traefik File Provider routing file for an app whose domain/extraDomains/wwwRedirect
 * changed after it was already deployed — the container itself is never touched (see
 * traefikDynamicConfig in packages/shared for why this is safe to apply without a redeploy). Used by
 * the domain PUT route instead of requiring a full deploy; a normal deploy writes this same file
 * itself (deployApplication.ts) and doesn't need this job. docker_compose apps never reach here — see
 * the route that enqueues this.
 */
export function makeApplicationRoutingProcessor() {
  return async function applicationRouting(job: Job<ApplicationRoutingJobData>) {
    const { applicationId } = job.data;
    const [application] = await db.select().from(applications).where(eq(applications.id, applicationId)).limit(1);
    if (!application) return;
    const [server] = await db.select().from(servers).where(eq(servers.id, application.serverId)).limit(1);
    if (!server) return;

    const containerName = `yeah-app-${application.id}`;
    const conn = await connectSsh({ host: server.host, port: server.port, username: server.sshUser, privateKey: server.privateKey, timeoutMs: server.sshTimeoutSeconds * 1000 });
    try {
      await writeAppRouting(conn, application, containerName, application.domain);
    } finally {
      conn.end();
    }
  };
}
