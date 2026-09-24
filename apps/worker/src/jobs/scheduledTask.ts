import { composeExecCommand, composeProjectName } from "@yeah/shared";
import { and, desc, eq, sql } from "drizzle-orm";
import { applications, scheduledTaskExecutions, scheduledTasks, servers } from "@yeah/db";
import { connectSsh, execStream } from "@yeah/ssh";
import type { ScheduledTaskJobData } from "@yeah/queue";
import type { Job } from "bullmq";
import { db } from "../lib/db";
import { notifyTeam } from "../lib/notify";
import { appendCapped, buildTaskCommand, KEEP_EXECUTIONS } from "./scheduledTask.commands";

export { buildTaskCommand, appendCapped } from "./scheduledTask.commands";

export function makeScheduledTaskProcessor() {
  return async function scheduledTask(job: Job<ScheduledTaskJobData>) {
    const { taskId, manual } = job.data;
    const [task] = await db.select().from(scheduledTasks).where(eq(scheduledTasks.id, taskId)).limit(1);
    if (!task) return;
    if (!task.enabled && !manual) return;

    const [application] = await db.select().from(applications).where(eq(applications.id, task.applicationId)).limit(1);
    if (!application) return;
    const [server] = await db.select().from(servers).where(eq(servers.id, application.serverId)).limit(1);
    if (!server) return;

    const [execution] = await db
      .insert(scheduledTaskExecutions)
      .values({ taskId, status: "running", manual: Boolean(manual) })
      .returning();
    if (!execution) return;

    let log = "";
    let exitCode: number | null = null;
    let failure: string | null = null;
    let conn: Awaited<ReturnType<typeof connectSsh>> | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      conn = await connectSsh({ host: server.host, port: server.port, username: server.sshUser, privateKey: server.privateKey, timeoutMs: server.sshTimeoutSeconds * 1000 });
      const command =
        application.buildPack === "docker_compose"
          ? composeExecCommand(composeProjectName(application.id), application.composeService, task.command)
          : buildTaskCommand(`yeah-app-${application.id}`, task.command);

      // Bounded by the task's own timeout: ending the connection kills the remote exec channel.
      const timedOut = new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), task.timeoutSeconds * 1000);
      });
      const run = execStream(conn, command, (chunk) => {
        log = appendCapped(log, chunk);
      });
      const outcome = await Promise.race([run, timedOut]);
      if (outcome === "timeout") {
        failure = `excedeu o limite de ${task.timeoutSeconds}s`;
        conn.end();
      } else {
        exitCode = outcome.exitCode;
        if (outcome.exitCode !== 0) failure = `saiu com código ${outcome.exitCode}`;
      }
    } catch (err) {
      failure = err instanceof Error ? err.message : String(err);
    } finally {
      clearTimeout(timer);
      conn?.end();
    }

    if (failure) log = appendCapped(log, `\n[${failure}]\n`);
    await db
      .update(scheduledTaskExecutions)
      .set({ status: failure ? "failed" : "success", log, exitCode, finishedAt: new Date() })
      .where(eq(scheduledTaskExecutions.id, execution.id));

    // Keep the history bounded.
    const old = await db
      .select({ id: scheduledTaskExecutions.id })
      .from(scheduledTaskExecutions)
      .where(eq(scheduledTaskExecutions.taskId, taskId))
      .orderBy(desc(scheduledTaskExecutions.startedAt))
      .offset(KEEP_EXECUTIONS);
    for (const row of old) await db.delete(scheduledTaskExecutions).where(eq(scheduledTaskExecutions.id, row.id));

    if (failure) {
      await notifyTeam(application.teamId, "task.failed", `Tarefa "${task.name}" falhou em ${application.name}`, failure, "error");
    }
  };
}
