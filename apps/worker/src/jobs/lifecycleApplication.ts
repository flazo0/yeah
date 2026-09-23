import { eq } from "drizzle-orm";
import { applications, servers } from "@yeah/db";
import { connectSsh, execStream } from "@yeah/ssh";
import { publishServerEvent, type ApplicationLifecycleJobData } from "@yeah/queue";
import type { Job } from "bullmq";
import type Redis from "ioredis";
import { db } from "../lib/db";
import { notifyTeam } from "../lib/notify";
import { buildLifecycleCommand, lifecycleResultStatus } from "./lifecycleApplication.commands";

export { buildLifecycleCommand, lifecycleResultStatus } from "./lifecycleApplication.commands";

export function makeLifecycleApplicationProcessor(publishConnection: Redis) {
  return async function lifecycleApplication(job: Job<ApplicationLifecycleJobData>) {
    const { applicationId, action } = job.data;
    const [application] = await db.select().from(applications).where(eq(applications.id, applicationId)).limit(1);
    if (!application) return;
    const [server] = await db.select().from(servers).where(eq(servers.id, application.serverId)).limit(1);
    if (!server) return;

    const setStatus = async (status: typeof application.status) => {
      await db.update(applications).set({ status }).where(eq(applications.id, applicationId));
      await publishServerEvent(publishConnection, { type: "application.status", applicationId, status });
    };

    let conn: Awaited<ReturnType<typeof connectSsh>> | null = null;
    try {
      conn = await connectSsh({ host: server.host, port: server.port, username: server.sshUser, privateKey: server.privateKey });
      let output = "";
      const result = await execStream(
        conn,
        buildLifecycleCommand(action, `yeah-app-${application.id}`, application.stopGraceSeconds),
        (chunk) => {
          output += chunk;
        },
      );
      if (result.exitCode !== 0) throw new Error(output.trim() || `docker saiu com código ${result.exitCode}`);
      await setStatus(lifecycleResultStatus(action));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[worker] application-lifecycle: ${action} failed for ${applicationId}: ${message}`);
      await setStatus("error");
      await notifyTeam(application.teamId, "deploy.failed", `Falha ao executar "${action}" em ${application.name}`, message, "error");
    } finally {
      conn?.end();
    }
  };
}
