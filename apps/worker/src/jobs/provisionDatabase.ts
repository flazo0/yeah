import { eq } from "drizzle-orm";
import { databases, servers } from "@yeah/db";
import { connectSsh, execStream } from "@yeah/ssh";
import { publishServerEvent, type DatabaseProvisionJobData } from "@yeah/queue";
import { shellQuote } from "@yeah/shared";
import type { Job } from "bullmq";
import type Redis from "ioredis";
import { db } from "../lib/db";
import { buildRunCommand, containerNameForDatabase } from "./provisionDatabase.commands";

export { buildRunCommand, containerNameForDatabase } from "./provisionDatabase.commands";

export function makeProvisionDatabaseProcessor(publishConnection: Redis) {
  return async function provisionDatabase(job: Job<DatabaseProvisionJobData>) {
    const { databaseId } = job.data;

    const rows = await db.select().from(databases).where(eq(databases.id, databaseId)).limit(1);
    const database = rows[0];
    if (!database) {
      console.warn(`[worker] database-provision: database ${databaseId} not found, skipping`);
      return;
    }

    const serverRows = await db.select().from(servers).where(eq(servers.id, database.serverId)).limit(1);
    const server = serverRows[0];
    if (!server) {
      await db.update(databases).set({ status: "error" }).where(eq(databases.id, databaseId));
      return;
    }

    const containerName = containerNameForDatabase(databaseId);
    const volumeName = `${containerName}-data`;

    try {
      const conn = await connectSsh({
        host: server.host,
        port: server.port,
        username: server.sshUser,
        privateKey: server.privateKey,
      });

      try {
        const command =
          `docker rm -f ${shellQuote(containerName)} >/dev/null 2>&1 || true && ` +
          buildRunCommand(database, containerName, volumeName);

        let output = "";
        const result = await execStream(conn, command, (chunk) => {
          output += chunk;
        });
        if (result.exitCode !== 0) {
          throw new Error(`docker run exited with code ${result.exitCode}: ${output.trim()}`);
        }

        await db.update(databases).set({ status: "running" }).where(eq(databases.id, databaseId));
        await publishServerEvent(publishConnection, { type: "database.status", databaseId, status: "running" });
      } finally {
        conn.end();
      }
    } catch (err) {
      console.error(`[worker] database-provision: failed for ${databaseId}:`, err);
      await db.update(databases).set({ status: "error" }).where(eq(databases.id, databaseId));
      await publishServerEvent(publishConnection, { type: "database.status", databaseId, status: "error" });
    }
  };
}
