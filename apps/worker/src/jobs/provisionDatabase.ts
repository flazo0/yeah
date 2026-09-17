import { eq } from "drizzle-orm";
import { databases, servers, type Database } from "@yeah/db";
import { connectSsh, execStream, shellQuote } from "@yeah/ssh";
import { publishServerEvent, type DatabaseProvisionJobData } from "@yeah/queue";
import { resourceLimitFlags } from "@yeah/shared";
import type { Job } from "bullmq";
import type Redis from "ioredis";
import { db } from "../lib/db";

export function containerNameForDatabase(databaseId: string): string {
  return `yeah-db-${databaseId}`;
}

function buildRunCommand(database: Database, containerName: string, volumeName: string): string {
  const base = `docker run -d --name ${shellQuote(containerName)} ` + resourceLimitFlags(database);
  const restart = `--restart unless-stopped ${shellQuote(database.image)}`;

  switch (database.engine) {
    case "postgresql":
      return (
        base +
        `-e POSTGRES_USER=${shellQuote(database.username ?? "postgres")} ` +
        `-e POSTGRES_PASSWORD=${shellQuote(database.password)} ` +
        `-e POSTGRES_DB=${shellQuote(database.databaseName ?? "app")} ` +
        `-p ${database.port}:5432 ` +
        `-v ${shellQuote(volumeName)}:/var/lib/postgresql/data ` +
        restart
      );
    case "mysql":
      return (
        base +
        `-e MYSQL_ROOT_PASSWORD=${shellQuote(database.password)} ` +
        `-e MYSQL_USER=${shellQuote(database.username ?? "app")} ` +
        `-e MYSQL_PASSWORD=${shellQuote(database.password)} ` +
        `-e MYSQL_DATABASE=${shellQuote(database.databaseName ?? "app")} ` +
        `-p ${database.port}:3306 ` +
        `-v ${shellQuote(volumeName)}:/var/lib/mysql ` +
        restart
      );
    case "mariadb":
      return (
        base +
        `-e MARIADB_ROOT_PASSWORD=${shellQuote(database.password)} ` +
        `-e MARIADB_USER=${shellQuote(database.username ?? "app")} ` +
        `-e MARIADB_PASSWORD=${shellQuote(database.password)} ` +
        `-e MARIADB_DATABASE=${shellQuote(database.databaseName ?? "app")} ` +
        `-p ${database.port}:3306 ` +
        `-v ${shellQuote(volumeName)}:/var/lib/mysql ` +
        restart
      );
    case "redis":
      return (
        base +
        `-p ${database.port}:6379 ` +
        `-v ${shellQuote(volumeName)}:/data ` +
        restart +
        ` redis-server --requirepass ${shellQuote(database.password)} --appendonly yes`
      );
    case "mongodb":
      return (
        base +
        `-e MONGO_INITDB_ROOT_USERNAME=${shellQuote(database.username ?? "root")} ` +
        `-e MONGO_INITDB_ROOT_PASSWORD=${shellQuote(database.password)} ` +
        `-e MONGO_INITDB_DATABASE=${shellQuote(database.databaseName ?? "app")} ` +
        `-p ${database.port}:27017 ` +
        `-v ${shellQuote(volumeName)}:/data/db ` +
        restart
      );
  }
}

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
