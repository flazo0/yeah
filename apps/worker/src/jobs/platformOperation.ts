import { eq, sql } from "drizzle-orm";
import { platformOperations, servers, type PlatformOperation } from "@yeah/db";
import { connectSsh, execStream, type Client } from "@yeah/ssh";
import { publishServerEvent, type PlatformOperationJobData } from "@yeah/queue";
import type { Job, Queue } from "bullmq";
import type Redis from "ioredis";
import { db } from "../lib/db";
import { buildLaunchCommand, buildLogTailCommand, FAIL_MARKER, OK_MARKER, SYSTEM_UPDATE_COMMAND } from "./platformOperation.commands";

export { buildLaunchCommand, buildLogTailCommand } from "./platformOperation.commands";

const POLL_DELAY_MS = 5_000;
const LAUNCH_TIMEOUT_MS = 15 * 60 * 1000;

async function findPlatformHost() {
  const rows = await db.select().from(servers).where(eq(servers.isPlatformHost, true)).limit(1);
  return rows[0] ?? null;
}

async function connectToPlatformHost(): Promise<{ conn: Client } | { error: string }> {
  const server = await findPlatformHost();
  if (!server) return { error: "nenhum servidor marcado como host da plataforma (instalação sem o setup automático do install.sh)" };
  try {
    const conn = await connectSsh({ host: server.host, port: server.port, username: server.sshUser, privateKey: server.privateKey });
    return { conn };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// Atomic column-level concatenation (SET log = log || chunk) rather than read-modify-write —
// execStream's onData callback isn't awaited at each call site, so multiple chunks can be
// in flight to the DB at once; a read-then-write here would lose data under that overlap.
async function appendLog(operationId: string, publishConnection: Redis, chunk: string) {
  if (!chunk) return;
  await db
    .update(platformOperations)
    .set({ log: sql`${platformOperations.log} || ${chunk}` })
    .where(eq(platformOperations.id, operationId));
  await publishServerEvent(publishConnection, { type: "platform-operation.log", operationId, line: chunk });
}

async function finish(operationId: string, publishConnection: Redis, status: "success" | "failed") {
  await db.update(platformOperations).set({ status, finishedAt: new Date() }).where(eq(platformOperations.id, operationId));
  await publishServerEvent(publishConnection, { type: "platform-operation.status", operationId, status });
}

export function makePlatformOperationProcessor(publishConnection: Redis, queue: Queue<PlatformOperationJobData>) {
  return async function platformOperation(job: Job<PlatformOperationJobData>) {
    const { operationId } = job.data;

    const rows = await db.select().from(platformOperations).where(eq(platformOperations.id, operationId)).limit(1);
    const operation = rows[0];
    if (!operation) {
      console.warn(`[worker] platform-operation: ${operationId} not found, skipping`);
      return;
    }

    if (operation.kind === "system_update") {
      await runSystemUpdate(operation, publishConnection);
      return;
    }

    if (operation.status === "queued") {
      await launchPlatformUpdate(operation, publishConnection, queue);
    } else if (operation.status === "running") {
      await pollPlatformUpdate(operation, publishConnection, queue);
    }
  };
}

async function runSystemUpdate(operation: PlatformOperation, publishConnection: Redis) {
  const operationId = operation.id;
  await db.update(platformOperations).set({ status: "running", startedAt: new Date() }).where(eq(platformOperations.id, operationId));
  await publishServerEvent(publishConnection, { type: "platform-operation.status", operationId, status: "running" });

  const target = await connectToPlatformHost();
  if ("error" in target) {
    await appendLog(operationId, publishConnection, `\nfalha: ${target.error}\n`);
    await finish(operationId, publishConnection, "failed");
    return;
  }

  try {
    const result = await execStream(target.conn, SYSTEM_UPDATE_COMMAND, (chunk) => {
      void appendLog(operationId, publishConnection, chunk);
    });
    await finish(operationId, publishConnection, result.exitCode === 0 ? "success" : "failed");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await appendLog(operationId, publishConnection, `\nfalha: ${message}\n`);
    await finish(operationId, publishConnection, "failed");
  } finally {
    target.conn.end();
  }
}

async function launchPlatformUpdate(operation: PlatformOperation, publishConnection: Redis, queue: Queue<PlatformOperationJobData>) {
  const operationId = operation.id;
  const target = await connectToPlatformHost();
  if ("error" in target) {
    await appendLog(operationId, publishConnection, `\nfalha: ${target.error}\n`);
    await finish(operationId, publishConnection, "failed");
    return;
  }

  try {
    let launched = false;
    const result = await execStream(target.conn, buildLaunchCommand(), (chunk) => {
      if (chunk.includes("LAUNCHED")) launched = true;
      void appendLog(operationId, publishConnection, chunk);
    });
    if (result.exitCode !== 0 || !launched) {
      await appendLog(operationId, publishConnection, "\nnão foi possível iniciar a atualização em segundo plano\n");
      await finish(operationId, publishConnection, "failed");
      return;
    }

    await db.update(platformOperations).set({ status: "running", startedAt: new Date() }).where(eq(platformOperations.id, operationId));
    await publishServerEvent(publishConnection, { type: "platform-operation.status", operationId, status: "running" });
    await queue.add("platform-operation", { operationId }, { delay: POLL_DELAY_MS });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await appendLog(operationId, publishConnection, `\nfalha ao iniciar: ${message}\n`);
    await finish(operationId, publishConnection, "failed");
  } finally {
    target.conn.end();
  }
}

async function pollPlatformUpdate(operation: PlatformOperation, publishConnection: Redis, queue: Queue<PlatformOperationJobData>) {
  const operationId = operation.id;

  if (operation.startedAt && Date.now() - operation.startedAt.getTime() > LAUNCH_TIMEOUT_MS) {
    await appendLog(operationId, publishConnection, "\ntimeout esperando a atualização terminar\n");
    await finish(operationId, publishConnection, "failed");
    return;
  }

  const target = await connectToPlatformHost();
  if ("error" in target) {
    // Transient — the host may be mid-restart (that's the whole point of this update). Try again.
    await queue.add("platform-operation", { operationId }, { delay: POLL_DELAY_MS });
    return;
  }

  try {
    let remoteLog = "";
    await execStream(target.conn, buildLogTailCommand(), (chunk) => {
      remoteLog += chunk;
    });

    const currentLog = (
      await db.select({ log: platformOperations.log }).from(platformOperations).where(eq(platformOperations.id, operationId)).limit(1)
    )[0]?.log ?? "";
    if (remoteLog.length > currentLog.length) {
      await appendLog(operationId, publishConnection, remoteLog.slice(currentLog.length));
    }

    if (remoteLog.includes(OK_MARKER)) {
      await finish(operationId, publishConnection, "success");
    } else if (remoteLog.includes(FAIL_MARKER)) {
      await finish(operationId, publishConnection, "failed");
    } else {
      await queue.add("platform-operation", { operationId }, { delay: POLL_DELAY_MS });
    }
  } finally {
    target.conn.end();
  }
}
