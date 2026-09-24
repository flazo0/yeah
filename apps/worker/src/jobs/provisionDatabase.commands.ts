import type { Database } from "@yeah/db";
import { DATABASE_ENGINES, resourceLimitFlags, shellQuote } from "@yeah/shared";

// Pure command-building logic, kept separate from provisionDatabase.ts's SSH execution for the
// same reason as deployApplication.commands.ts — see that file's comment.

export function containerNameForDatabase(databaseId: string): string {
  return `yeah-db-${databaseId}`;
}

/** Where a database's TLS files live on the server (mounted read-only at /certs). */
export const dbCertDir = (databaseId: string) => `/opt/yeah-db/${databaseId}/ssl`;
/** Where its dumps live on the server — ClickHouse writes its backups straight into it. */
export const dbBackupsDir = (databaseId: string) => `/opt/yeah-backups/${databaseId}`;
/** Extra config files (ClickHouse). */
export const dbConfigDir = (databaseId: string) => `/opt/yeah-db/${databaseId}/config`;

export interface RunOptions {
  /** The environment's docker network and this database's name on it. */
  networkName: string;
  alias: string;
}

/** The account each engine's server process runs as — the TLS key must be readable by it. */
export const ENGINE_RUN_USER: Record<Database["engine"], string> = {
  postgresql: "postgres",
  mysql: "mysql",
  mariadb: "mysql",
  redis: "redis",
  keydb: "keydb",
  dragonfly: "dfly",
  mongodb: "mongodb",
  clickhouse: "clickhouse",
};

/**
 * `ssl=on` alone only *allows* TLS. This pg_hba makes it mandatory for network connections while the
 * container's own socket (pg_dump, psql via docker exec) keeps working.
 */
export function postgresHbaConfig(): string {
  return ["local all all trust", "hostssl all all all scram-sha-256", ""].join("\n");
}

/** ClickHouse only writes backups where its config allows it. */
export function clickhouseBackupsConfig(): string {
  return "<clickhouse>\n  <backups>\n    <allowed_path>/backups/</allowed_path>\n    <allow_concurrent_backups>false</allow_concurrent_backups>\n  </backups>\n</clickhouse>\n";
}

/** The shell command Docker runs inside the container to decide "healthy"; null when the engine has no client to ask. */
export function healthProbe(database: Database): string | null {
  const tls = database.ssl;
  switch (database.engine) {
    case "postgresql":
      return `pg_isready -U ${shellQuote(database.username ?? "postgres")} -d ${shellQuote(database.databaseName ?? "app")} -h 127.0.0.1`;
    case "mysql":
      return `mysqladmin ping -uroot -p"$MYSQL_ROOT_PASSWORD" --silent`;
    case "mariadb":
      return `mariadb-admin ping -uroot -p"$MARIADB_ROOT_PASSWORD" --silent`;
    case "redis":
      return `redis-cli ${tls ? "--tls --insecure " : ""}ping | grep -q PONG`;
    case "keydb":
      return `keydb-cli ${tls ? "--tls --insecure " : ""}ping | grep -q PONG`;
    case "dragonfly":
      return null;
    case "mongodb":
      return `mongosh --quiet ${tls ? "--tls --tlsAllowInvalidCertificates " : ""}--eval "db.adminCommand('ping').ok" | grep -q 1`;
    case "clickhouse":
      return `clickhouse-client -u "$CLICKHOUSE_USER" --password "$CLICKHOUSE_PASSWORD" -q 'SELECT 1' | grep -q 1`;
  }
}

export function healthFlags(database: Database): string {
  if (!database.healthEnabled) return "--no-healthcheck ";
  const probe = healthProbe(database);
  // No client to ask (Dragonfly): the image's own plain-TCP check is fine until TLS makes it always fail.
  if (!probe) return database.ssl ? "--no-healthcheck " : "";
  return (
    `--health-cmd ${shellQuote(probe)} ` +
    `--health-interval ${database.healthIntervalSeconds}s ` +
    `--health-timeout ${database.healthTimeoutSeconds}s ` +
    `--health-retries ${database.healthRetries} ` +
    // Databases take a while to initialise their data directory the first time.
    `--health-start-period 60s `
  );
}

/** Seconds the provisioning job waits for "healthy" before calling the database broken. */
export function healthWaitSeconds(database: Database): number {
  return 60 + database.healthIntervalSeconds * database.healthRetries + 30;
}

export function buildRunCommand(database: Database, containerName: string, volumeName: string, options?: RunOptions): string {
  const info = DATABASE_ENGINES[database.engine];
  const internal = info.internalPort;
  const publish = database.publicAccess ? `-p ${database.port}:${internal} ` : "";
  const network = options ? `--network ${shellQuote(options.networkName)} --network-alias ${shellQuote(options.alias)} ` : "";
  const certs = database.ssl ? `-v ${shellQuote(dbCertDir(database.id))}:/certs:ro ` : "";
  const base = `docker run -d --name ${shellQuote(containerName)} ` + resourceLimitFlags(database) + network + healthFlags(database);
  const restart = `--restart unless-stopped ${shellQuote(database.image)}`;
  const password = shellQuote(database.password);

  switch (database.engine) {
    case "postgresql":
      return (
        base +
        `-e POSTGRES_USER=${shellQuote(database.username ?? "postgres")} ` +
        `-e POSTGRES_PASSWORD=${password} ` +
        `-e POSTGRES_DB=${shellQuote(database.databaseName ?? "app")} ` +
        publish +
        certs +
        `-v ${shellQuote(volumeName)}:/var/lib/postgresql/data ` +
        restart +
        (database.ssl ? " -c ssl=on -c ssl_cert_file=/certs/server.crt -c ssl_key_file=/certs/server.key -c hba_file=/certs/pg_hba.conf" : "")
      );
    case "mysql":
      return (
        base +
        `-e MYSQL_ROOT_PASSWORD=${password} ` +
        `-e MYSQL_USER=${shellQuote(database.username ?? "app")} ` +
        `-e MYSQL_PASSWORD=${password} ` +
        `-e MYSQL_DATABASE=${shellQuote(database.databaseName ?? "app")} ` +
        publish +
        certs +
        `-v ${shellQuote(volumeName)}:/var/lib/mysql ` +
        restart +
        (database.ssl ? " --ssl-cert=/certs/server.crt --ssl-key=/certs/server.key --require-secure-transport=ON" : "")
      );
    case "mariadb":
      return (
        base +
        `-e MARIADB_ROOT_PASSWORD=${password} ` +
        `-e MARIADB_USER=${shellQuote(database.username ?? "app")} ` +
        `-e MARIADB_PASSWORD=${password} ` +
        `-e MARIADB_DATABASE=${shellQuote(database.databaseName ?? "app")} ` +
        publish +
        certs +
        `-v ${shellQuote(volumeName)}:/var/lib/mysql ` +
        restart +
        (database.ssl ? " --ssl-cert=/certs/server.crt --ssl-key=/certs/server.key --require-secure-transport=ON" : "")
      );
    case "redis":
      // REDISCLI_AUTH lets the health probe (and a shell into the container) authenticate without the password on a command line.
      return (
        base +
        `-e REDISCLI_AUTH=${password} ` +
        publish +
        certs +
        `-v ${shellQuote(volumeName)}:/data ` +
        restart +
        ` redis-server --requirepass ${password} --appendonly yes` +
        (database.ssl ? " --port 0 --tls-port 6379 --tls-cert-file /certs/server.crt --tls-key-file /certs/server.key --tls-auth-clients no --tls-ca-cert-file /certs/server.crt" : "")
      );
    case "keydb":
      return (
        base +
        `-e REDISCLI_AUTH=${password} ` +
        publish +
        certs +
        `-v ${shellQuote(volumeName)}:/data ` +
        restart +
        ` keydb-server --requirepass ${password} --appendonly yes` +
        (database.ssl ? " --port 0 --tls-port 6379 --tls-cert-file /certs/server.crt --tls-key-file /certs/server.key --tls-auth-clients no --tls-ca-cert-file /certs/server.crt" : "")
      );
    case "dragonfly":
      return (
        base +
        publish +
        certs +
        `-v ${shellQuote(volumeName)}:/data ` +
        restart +
        ` --requirepass=${password} --dir=/data` +
        // Dragonfly refuses to start when memory is tight (it wants ~256 MiB per thread of --maxmemory): with a memory limit, size maxmemory and threads to it.
        (database.memoryLimitMb ? ` --maxmemory=${database.memoryLimitMb}mb --proactor_threads=${Math.max(1, Math.floor(database.memoryLimitMb / 256))}` : "") +
        (database.ssl ? " --tls --tls_cert_file=/certs/server.crt --tls_key_file=/certs/server.key" : "")
      );
    case "mongodb":
      return (
        base +
        `-e MONGO_INITDB_ROOT_USERNAME=${shellQuote(database.username ?? "root")} ` +
        `-e MONGO_INITDB_ROOT_PASSWORD=${password} ` +
        `-e MONGO_INITDB_DATABASE=${shellQuote(database.databaseName ?? "app")} ` +
        publish +
        certs +
        `-v ${shellQuote(volumeName)}:/data/db ` +
        restart +
        (database.ssl ? " --tlsMode requireTLS --tlsCertificateKeyFile /certs/server.pem --tlsCAFile /certs/server.crt --tlsAllowConnectionsWithoutCertificates" : "")
      );
    case "clickhouse":
      return (
        base +
        `-e CLICKHOUSE_USER=${shellQuote(database.username ?? "app")} ` +
        `-e CLICKHOUSE_PASSWORD=${password} ` +
        `-e CLICKHOUSE_DB=${shellQuote(database.databaseName ?? "app")} ` +
        `-e CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT=1 ` +
        publish +
        `-v ${shellQuote(volumeName)}:/var/lib/clickhouse ` +
        `-v ${shellQuote(dbConfigDir(database.id))}/backups.xml:/etc/clickhouse-server/config.d/yeah-backups.xml:ro ` +
        `-v ${shellQuote(dbBackupsDir(database.id))}:/backups ` +
        `--ulimit nofile=262144:262144 ` +
        restart
      );
  }
}
