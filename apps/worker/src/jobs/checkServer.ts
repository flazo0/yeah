import { eq } from "drizzle-orm";
import { servers } from "@yeah/db";
import { testSshConnection } from "@yeah/ssh";
import { publishServerEvent, type ServerCheckJobData } from "@yeah/queue";
import type { Job } from "bullmq";
import type Redis from "ioredis";
import { db } from "../lib/db";
import { notifyTeam } from "../lib/notify";

export function makeCheckServerProcessor(publishConnection: Redis) {
  return async function checkServer(job: Job<ServerCheckJobData>) {
    const { serverId } = job.data;

    const rows = await db.select().from(servers).where(eq(servers.id, serverId)).limit(1);
    const server = rows[0];
    if (!server) {
      console.warn(`[worker] server-check: server ${serverId} not found, skipping`);
      return;
    }

    // testSshConnection already turns SSH-level failures into { ok: false }, but this
    // still guards against anything unexpected — a server must never get stuck on
    // "pending" with no feedback just because one check blew up.
    let result: { ok: boolean; dockerVersion?: string };
    try {
      result = await testSshConnection({
        host: server.host,
        port: server.port,
        username: server.sshUser,
        privateKey: server.privateKey,
      timeoutMs: server.sshTimeoutSeconds * 1000,
      });
    } catch (err) {
      result = { ok: false };
      console.error(`[worker] server-check: unexpected error for ${serverId}:`, err);
    }

    await db
      .update(servers)
      .set({
        status: result.ok ? "connected" : "error",
        dockerVersion: result.dockerVersion ?? null,
        lastCheckedAt: new Date(),
      })
      .where(eq(servers.id, serverId));

    await publishServerEvent(publishConnection, {
      type: "server.status",
      serverId,
      status: result.ok ? "connected" : "error",
      dockerVersion: result.dockerVersion,
    });

    // Only alert on the transition, not on every check while a server stays down — otherwise
    // this fires every time someone reopens the Servidores page and re-tests.
    if (server.status !== "error" && !result.ok) {
      await notifyTeam(server.teamId, "server.down", `Servidor ${server.name} inacessível`, "A conexão SSH falhou no teste de conexão.", "error");
    } else if (server.status === "error" && result.ok) {
      await notifyTeam(server.teamId, "server.reconnected", `Servidor ${server.name} reconectou`, "A conexão SSH voltou a funcionar.", "info");
    }
  };
}
