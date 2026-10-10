import { and, desc, eq, inArray } from "drizzle-orm";
import { applications, backupSchedules, databases, deployments, environments, notificationChannels, projects, s3Storages, scheduledTasks, servers, services } from "@yeah/db";
import { db } from "./db";
import { overloadReason } from "./serverLoad";
import { applicationDeployQueue, databaseBackupQueue } from "./queue";

/** Shared by the token-authenticated REST routes (routes/ci.ts) and the MCP endpoint (routes/mcp.ts). */
export type ActionResult<T> = { ok: true; value: T } | { ok: false; status: number; error: string; code?: string };

export async function listApplications(teamId: string) {
  return db
    .select({ id: applications.id, name: applications.name, status: applications.status, domain: applications.domain, serverId: applications.serverId })
    .from(applications)
    .where(eq(applications.teamId, teamId));
}

export async function listDatabases(teamId: string) {
  return db.select({ id: databases.id, name: databases.name, engine: databases.engine, status: databases.status }).from(databases).where(eq(databases.teamId, teamId));
}

export async function listServices(teamId: string) {
  return db.select({ id: services.id, name: services.name, status: services.status }).from(services).where(eq(services.teamId, teamId));
}

/** Status only — never the build log. */
export async function listDeployments(teamId: string, applicationId: string): Promise<ActionResult<unknown[]>> {
  const [application] = await db.select({ id: applications.id }).from(applications).where(and(eq(applications.id, applicationId), eq(applications.teamId, teamId))).limit(1);
  if (!application) return { ok: false, status: 404, error: "application not found" };
  const rows = await db
    .select({ id: deployments.id, status: deployments.status, createdAt: deployments.createdAt, finishedAt: deployments.finishedAt })
    .from(deployments)
    .where(eq(deployments.applicationId, applicationId))
    .orderBy(desc(deployments.createdAt))
    .limit(10);
  return { ok: true, value: rows };
}

export async function triggerDeploy(teamId: string, applicationId: string, force: boolean): Promise<ActionResult<{ deploymentId: string }>> {
  const [application] = await db.select().from(applications).where(and(eq(applications.id, applicationId), eq(applications.teamId, teamId))).limit(1);
  if (!application) return { ok: false, status: 404, error: "application not found" };
  const [server] = await db.select().from(servers).where(eq(servers.id, application.serverId)).limit(1);
  const overload = server ? overloadReason(server) : null;
  if (overload && !force) return { ok: false, status: 409, error: overload, code: "server_overloaded" };
  const [deployment] = await db.insert(deployments).values({ applicationId: application.id, status: "queued" }).returning();
  if (!deployment) return { ok: false, status: 500, error: "failed to create deployment" };
  await applicationDeployQueue.add("deploy", { deploymentId: deployment.id });
  return { ok: true, value: { deploymentId: deployment.id } };
}

export async function triggerBackup(teamId: string, databaseId: string): Promise<ActionResult<{ queued: true }>> {
  const [database] = await db.select({ id: databases.id }).from(databases).where(and(eq(databases.id, databaseId), eq(databases.teamId, teamId))).limit(1);
  if (!database) return { ok: false, status: 404, error: "database not found" };
  const [schedule] = await db.select().from(backupSchedules).where(eq(backupSchedules.databaseId, database.id)).limit(1);
  if (!schedule) return { ok: false, status: 404, error: "este banco não tem um agendamento de backup — crie um pelo painel antes de disparar por aqui" };
  await databaseBackupQueue.add("backup", { scheduleId: schedule.id, manual: true });
  return { ok: true, value: { queued: true } };
}

export type MovableKind = "application" | "database" | "service";

/**
 * Re-parents a resource to another environment of the same team. Containers are named by resource id and
 * nothing on the server refers to the environment, so this is a pure metadata change (no redeploy) —
 * the one thing it can affect is `environment`-scoped shared variables, which now resolve against the new one.
 */
export async function moveResource(teamId: string, kind: MovableKind, resourceId: string, targetEnvironmentId: string): Promise<ActionResult<{ environmentId: string }>> {
  const [target] = await db
    .select({ id: environments.id })
    .from(environments)
    .innerJoin(projects, eq(environments.projectId, projects.id))
    .where(and(eq(environments.id, targetEnvironmentId), eq(projects.teamId, teamId)))
    .limit(1);
  if (!target) return { ok: false, status: 404, error: "environment not found" };
  const table = kind === "application" ? applications : kind === "database" ? databases : services;
  const updated = await db
    .update(table)
    .set({ environmentId: target.id })
    .where(and(eq(table.id, resourceId), eq(table.teamId, teamId)))
    .returning({ id: table.id });
  if (updated.length === 0) return { ok: false, status: 404, error: `${kind} not found` };
  return { ok: true, value: { environmentId: target.id } };
}

/** Read-only listings for the rest of the v1 surface. None of them selects a secret column. */
export async function listServers(teamId: string) {
  return db.select({ id: servers.id, name: servers.name, host: servers.host, status: servers.status, proxyStatus: servers.proxyStatus }).from(servers).where(eq(servers.teamId, teamId));
}

export async function listProjects(teamId: string) {
  const projectRows = await db.select({ id: projects.id, name: projects.name }).from(projects).where(eq(projects.teamId, teamId));
  if (projectRows.length === 0) return [];
  const envRows = await db
    .select({ id: environments.id, name: environments.name, projectId: environments.projectId })
    .from(environments)
    .where(inArray(environments.projectId, projectRows.map((p) => p.id)));
  return projectRows.map((p) => ({ ...p, environments: envRows.filter((e) => e.projectId === p.id).map(({ id, name }) => ({ id, name })) }));
}

export async function listStorages(teamId: string) {
  return db.select({ id: s3Storages.id, name: s3Storages.name, bucket: s3Storages.bucket, region: s3Storages.region, endpoint: s3Storages.endpoint }).from(s3Storages).where(eq(s3Storages.teamId, teamId));
}

export async function listNotificationChannels(teamId: string) {
  return db.select({ id: notificationChannels.id, name: notificationChannels.name, type: notificationChannels.type }).from(notificationChannels).where(eq(notificationChannels.teamId, teamId));
}

export async function listScheduledTasks(teamId: string) {
  return db
    .select({ id: scheduledTasks.id, name: scheduledTasks.name, cron: scheduledTasks.cron, enabled: scheduledTasks.enabled, applicationId: scheduledTasks.applicationId })
    .from(scheduledTasks)
    .innerJoin(applications, eq(scheduledTasks.applicationId, applications.id))
    .where(eq(applications.teamId, teamId));
}
