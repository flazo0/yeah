import { eq } from "drizzle-orm";
import { databases, servers } from "@yeah/db";
import { connectSsh, execStream, generateSelfSignedCert, writeRemoteFile } from "@yeah/ssh";
import { publishServerEvent, type DatabaseProvisionJobData } from "@yeah/queue";
import { DATABASE_ENGINES, ensureNetworkCommand, environmentNetworkName, internalHostName, shellQuote } from "@yeah/shared";
import type { Job } from "bullmq";
import type Redis from "ioredis";
import { db } from "../lib/db";
import { buildHealthWaitCommand } from "./deployApplication.commands";
import {
  buildRunCommand,
  clickhouseBackupsConfig,
  containerNameForDatabase,
  dbBackupsDir,
  dbCertDir,
  dbConfigDir,
  ENGINE_RUN_USER,
  postgresHbaConfig,
  healthProbe,
  healthWaitSeconds,
} from "./provisionDatabase.commands";

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
    const networkName = environmentNetworkName(database.environmentId);

    try {
      const conn = await connectSsh({
        host: server.host,
        port: server.port,
        username: server.sshUser,
        privateKey: server.privateKey,
        timeoutMs: server.sshTimeoutSeconds * 1000,
      });

      try {
        const run = async (command: string, what: string) => {
          let output = "";
          const result = await execStream(conn, command, (chunk) => {
            output += chunk;
          });
          if (result.exitCode !== 0) throw new Error(`${what} exited with code ${result.exitCode}: ${output.trim()}`);
          return output;
        };

        await run(ensureNetworkCommand(networkName), "docker network");

        if (database.ssl) {
          await installTlsFiles(conn, database, run);
        }
        if (database.engine === "clickhouse") {
          await run(`mkdir -p ${shellQuote(dbConfigDir(databaseId))} ${shellQuote(dbBackupsDir(databaseId))}`, "mkdir");
          await writeRemoteFile(conn, `${dbConfigDir(databaseId)}/backups.xml`, clickhouseBackupsConfig());
        }

        await run(
          `docker rm -f ${shellQuote(containerName)} >/dev/null 2>&1 || true && ` +
            buildRunCommand(database, containerName, volumeName, { networkName, alias: internalHostName(database.name) }),
          "docker run",
        );

        // "running" means the engine answers, not that the container merely started.
        if (database.healthEnabled && healthProbe(database)) {
          await run(buildHealthWaitCommand(containerName, healthWaitSeconds(database)), "healthcheck");
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

/**
 * Writes a fresh self-signed certificate for the database and hands the key to the account the engine
 * runs as (looked up inside the image itself, since uids differ between alpine and debian builds).
 * Where that account cannot be found the key falls back to world-readable — the host is the operator's.
 */
async function installTlsFiles(
  conn: Awaited<ReturnType<typeof connectSsh>>,
  database: typeof databases.$inferSelect,
  run: (command: string, what: string) => Promise<string>,
) {
  const dir = dbCertDir(database.id);
  const { certPem, keyPem } = generateSelfSignedCert(internalHostName(database.name));
  await run(`mkdir -p ${shellQuote(dir)}`, "mkdir");
  await writeRemoteFile(conn, `${dir}/server.crt`, certPem);
  await writeRemoteFile(conn, `${dir}/server.key`, keyPem);
  // MongoDB wants key and certificate in one file.
  await writeRemoteFile(conn, `${dir}/server.pem`, keyPem + certPem);
  if (database.engine === "postgresql") await writeRemoteFile(conn, `${dir}/pg_hba.conf`, postgresHbaConfig());

  const user = ENGINE_RUN_USER[database.engine];
  let uid = "";
  try {
    uid = (await run(`docker run --rm --entrypoint sh ${shellQuote(database.image)} -c ${shellQuote(`id -u ${user} 2>/dev/null`)}`, "uid lookup")).trim();
  } catch {
    uid = "";
  }
  const secret = /^\d+$/.test(uid)
    ? `chown ${uid}:${uid} ${shellQuote(`${dir}/server.key`)} ${shellQuote(`${dir}/server.pem`)} && chmod 600 ${shellQuote(`${dir}/server.key`)} ${shellQuote(`${dir}/server.pem`)}`
    : `chmod 644 ${shellQuote(`${dir}/server.key`)} ${shellQuote(`${dir}/server.pem`)}`;
  await run(`chmod 644 ${shellQuote(`${dir}/server.crt`)} ${shellQuote(`${dir}/pg_hba.conf`)} 2>/dev/null; ${secret} && chmod 755 ${shellQuote(dir)}`, "chmod");
  void DATABASE_ENGINES;
}
