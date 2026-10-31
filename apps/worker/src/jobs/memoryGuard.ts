import { and, eq } from "drizzle-orm";
import { applications, auditEvents, services, type Server } from "@yeah/db";
import { guardStep, INITIAL_GUARD_STATE, parseDockerStats, type GuardAction, type GuardState } from "@yeah/shared";
import type { ApplicationLifecycleJobData, ServiceProvisionJobData } from "@yeah/queue";
import type { Queue } from "bullmq";
import { db } from "../lib/db";
import { notifyTeam } from "../lib/notify";
import { buildGuardCandidates, staleShedFlags } from "./memoryGuard.commands";

export interface GuardQueues {
  applications: Queue<ApplicationLifecycleJobData>;
  services: Queue<ServiceProvisionJobData>;
}

// Consecutive-sample counters per server. In memory on purpose: after a worker restart the guard simply needs a
// couple of fresh samples before it acts again.
const states = new Map<string, GuardState>();

/** Called once per metrics tick for a server that answered. Never throws: the guard must not break the tick. */
export async function runMemoryGuard(server: Server, memPercent: number, containerOutput: string, queues: GuardQueues): Promise<void> {
  try {
    if (!server.memoryGuardEnabled) {
      states.delete(server.id);
      return;
    }
    const [apps, svcs] = await Promise.all([
      db.select().from(applications).where(eq(applications.serverId, server.id)),
      db.select().from(services).where(eq(services.serverId, server.id)),
    ]);
    const candidates = buildGuardCandidates(
      apps.map((a) => ({ id: a.id, name: a.name, priority: a.priority, shedByGuard: a.shedByGuard, status: a.status, isCompose: a.buildPack === "docker_compose" })),
      svcs.map((s) => ({ id: s.id, name: s.name, priority: s.priority, shedByGuard: s.shedByGuard, status: s.status, isStack: s.composeContent !== null })),
      parseDockerStats(containerOutput).map((s) => ({ name: s.name, memUsedBytes: s.memUsedBytes })),
    );

    // Started by hand (or redeployed) since the guard stopped it: it is no longer the guard's to restart.
    for (const stale of staleShedFlags(candidates)) {
      stale.shedByGuard = false;
      if (stale.kind === "application") await db.update(applications).set({ shedByGuard: false }).where(eq(applications.id, stale.id));
      else await db.update(services).set({ shedByGuard: false }).where(eq(services.id, stale.id));
    }

    const { state, action } = guardStep(
      states.get(server.id) ?? INITIAL_GUARD_STATE,
      memPercent,
      { enabled: true, threshold: server.memoryGuardThreshold, recover: server.memoryGuardRecover },
      candidates,
    );
    states.set(server.id, state);
    if (action.type !== "none") await carryOut(server, memPercent, action, queues);
  } catch (err) {
    console.error(`[worker] memory-guard: ${server.id}:`, err instanceof Error ? err.message : err);
  }
}

async function carryOut(server: Server, memPercent: number, action: Exclude<GuardAction, { type: "none" }>, queues: GuardQueues): Promise<void> {
  const { target } = action;
  const stopping = action.type === "stop";
  // The flag is written before the job is queued, so a stop that is picked up instantly is already marked.
  const table = target.kind === "application" ? applications : services;
  await db.update(table).set({ shedByGuard: stopping }).where(and(eq(table.id, target.id), eq(table.serverId, server.id)));
  if (target.kind === "application") await queues.applications.add(stopping ? "stop" : "start", { applicationId: target.id, action: stopping ? "stop" : "start" });
  else await queues.services.add(stopping ? "stop" : "start", { serviceId: target.id, action: stopping ? "stop" : "start" });

  await db.insert(auditEvents).values({
    teamId: server.teamId,
    actor: "Memory guard",
    action: stopping ? "stop (memory guard)" : "start (memory guard)",
    level: stopping ? "warning" : "info",
    resourceType: target.kind,
    resourceId: target.id,
    method: "SYSTEM",
    path: "/memory-guard",
  });

  if (stopping) {
    await notifyTeam(
      server.teamId,
      "server.metrics",
      `Memory guard stopped ${target.name} on ${server.name}`,
      `RAM was at ${memPercent}% (limit ${server.memoryGuardThreshold}%). ${target.name} has priority "${target.priority}", so it was stopped to keep the more important ones online. It starts again by itself when RAM is back under ${server.memoryGuardRecover}%.`,
      "warning",
    );
  } else {
    await notifyTeam(server.teamId, "server.metrics", `Memory guard started ${target.name} on ${server.name}`, `RAM is back at ${memPercent}% (under ${server.memoryGuardRecover}%), so ${target.name} is running again.`, "info");
  }
}
