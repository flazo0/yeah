import { describe, expect, test } from "bun:test";
import type { Database } from "@yeah/db";
import { buildRunCommand, clickhouseBackupsConfig, healthFlags, healthProbe, healthWaitSeconds, postgresHbaConfig } from "./provisionDatabase.commands";

function db(overrides: Partial<Database> = {}): Database {
  return {
    id: "db-1",
    teamId: "t",
    environmentId: "env-1",
    serverId: "s",
    name: "my-db",
    engine: "postgresql",
    image: "postgres:16-alpine",
    port: 5432,
    username: "app",
    password: "pw",
    databaseName: "app",
    publicAccess: false,
    ssl: false,
    healthEnabled: true,
    healthIntervalSeconds: 30,
    healthTimeoutSeconds: 10,
    healthRetries: 5,
    memoryLimitMb: null,
    cpuLimit: null,
    status: "idle",
    createdAt: new Date(),
    ...overrides,
  };
}
const opts = { networkName: "yeah-env-env-1", alias: "my-db" };

describe("public access and network", () => {
  test("private by default: no -p flag, joins the environment network with an alias", () => {
    const cmd = buildRunCommand(db(), "c", "v", opts);
    expect(cmd).not.toContain(" -p ");
    expect(cmd).toContain("--network 'yeah-env-env-1' --network-alias 'my-db'");
  });
  test("public access publishes the chosen host port onto the engine's internal port", () => {
    expect(buildRunCommand(db({ publicAccess: true, port: 15432 }), "c", "v", opts)).toContain("-p 15432:5432 ");
    expect(buildRunCommand(db({ engine: "clickhouse", image: "clickhouse/clickhouse-server:latest", publicAccess: true, port: 18123 }), "c", "v", opts)).toContain("-p 18123:8123 ");
  });
});

describe("new engines", () => {
  test("keydb: redis-style flags, password by env and flag", () => {
    const cmd = buildRunCommand(db({ engine: "keydb", image: "eqalpha/keydb:latest", username: null, databaseName: null }), "c", "v", opts);
    expect(cmd).toContain("-e REDISCLI_AUTH='pw'");
    expect(cmd).toContain("keydb-server --requirepass 'pw' --appendonly yes");
    expect(cmd).toContain("-v 'v':/data");
  });
  test("dragonfly: args go straight after the image", () => {
    const cmd = buildRunCommand(db({ engine: "dragonfly", image: "docker.dragonflydb.io/dragonflydb/dragonfly:latest", username: null, databaseName: null }), "c", "v", opts);
    expect(cmd).toContain("'docker.dragonflydb.io/dragonflydb/dragonfly:latest' --requirepass='pw' --dir=/data");
  });
  test("dragonfly with a memory limit sizes maxmemory and threads to it (256 MiB per thread)", () => {
    const cmd = buildRunCommand(db({ engine: "dragonfly", image: "df", username: null, databaseName: null, memoryLimitMb: 1024 }), "c", "v", opts);
    expect(cmd).toContain("--maxmemory=1024mb --proactor_threads=4");
    expect(buildRunCommand(db({ engine: "dragonfly", image: "df", username: null, databaseName: null, memoryLimitMb: 128 }), "c", "v", opts)).toContain("--proactor_threads=1");
  });
  test("clickhouse: user/password/db env, data dir, backups config and mount, raised file limit", () => {
    const cmd = buildRunCommand(db({ engine: "clickhouse", image: "clickhouse/clickhouse-server:latest" }), "c", "v", opts);
    expect(cmd).toContain("-e CLICKHOUSE_USER='app'");
    expect(cmd).toContain("-e CLICKHOUSE_PASSWORD='pw'");
    expect(cmd).toContain("-e CLICKHOUSE_DB='app'");
    expect(cmd).toContain("-v 'v':/var/lib/clickhouse");
    expect(cmd).toContain("/etc/clickhouse-server/config.d/yeah-backups.xml:ro");
    expect(cmd).toContain(":/backups ");
    expect(cmd).toContain("--ulimit nofile=262144:262144");
    expect(clickhouseBackupsConfig()).toContain("<allowed_path>/backups/</allowed_path>");
  });
});

describe("tls", () => {
  const certs = "-v '/opt/yeah-db/db-1/ssl':/certs:ro";
  test("postgresql", () => {
    const cmd = buildRunCommand(db({ ssl: true }), "c", "v", opts);
    expect(cmd).toContain(certs);
    expect(cmd).toContain("-c ssl=on -c ssl_cert_file=/certs/server.crt -c ssl_key_file=/certs/server.key -c hba_file=/certs/pg_hba.conf");
    expect(postgresHbaConfig()).toContain("hostssl all all all scram-sha-256");
  });
  test("mysql and mariadb require secure transport", () => {
    for (const engine of ["mysql", "mariadb"] as const) {
      expect(buildRunCommand(db({ engine, image: `${engine}:latest`, ssl: true }), "c", "v", opts)).toContain("--require-secure-transport=ON");
    }
  });
  test("redis family switches the plain port off and serves tls on 6379", () => {
    for (const [engine, image] of [["redis", "redis:7-alpine"], ["keydb", "eqalpha/keydb"]] as const) {
      const cmd = buildRunCommand(db({ engine, image, ssl: true, username: null, databaseName: null }), "c", "v", opts);
      expect(cmd).toContain("--port 0 --tls-port 6379");
      expect(cmd).toContain("--tls-cert-file /certs/server.crt");
    }
    expect(buildRunCommand(db({ engine: "dragonfly", image: "df", ssl: true, username: null, databaseName: null }), "c", "v", opts)).toContain("--tls --tls_cert_file=/certs/server.crt");
  });
  test("mongodb uses the combined pem", () => {
    expect(buildRunCommand(db({ engine: "mongodb", image: "mongo:7", ssl: true }), "c", "v", opts)).toContain("--tlsMode requireTLS --tlsCertificateKeyFile /certs/server.pem --tlsCAFile /certs/server.crt");
  });
  test("no certs mounted when tls is off", () => {
    expect(buildRunCommand(db(), "c", "v", opts)).not.toContain("/certs");
  });
});

describe("healthcheck", () => {
  test("probe per engine", () => {
    expect(healthProbe(db())).toBe("pg_isready -U 'app' -d 'app' -h 127.0.0.1");
    expect(healthProbe(db({ engine: "redis" }))).toBe("redis-cli ping | grep -q PONG");
    expect(healthProbe(db({ engine: "redis", ssl: true }))).toContain("--tls --insecure");
    expect(healthProbe(db({ engine: "mysql" }))).toContain("mysqladmin ping");
    expect(healthProbe(db({ engine: "clickhouse" }))).toContain("clickhouse-client");
    expect(healthProbe(db({ engine: "dragonfly" }))).toBeNull();
  });
  test("flags carry the configured interval, timeout, retries and a start period", () => {
    const flags = healthFlags(db({ healthIntervalSeconds: 15, healthTimeoutSeconds: 4, healthRetries: 3 }));
    expect(flags).toContain("--health-interval 15s");
    expect(flags).toContain("--health-timeout 4s");
    expect(flags).toContain("--health-retries 3");
    expect(flags).toContain("--health-start-period 60s");
  });
  test("disabled turns docker's own healthcheck off; an engine without a probe adds nothing", () => {
    expect(healthFlags(db({ healthEnabled: false }))).toBe("--no-healthcheck ");
    expect(healthFlags(db({ engine: "dragonfly" }))).toBe("");
    expect(healthFlags(db({ engine: "dragonfly", ssl: true }))).toBe("--no-healthcheck ");
  });
  test("the provisioning wait covers start period + all retries", () => {
    expect(healthWaitSeconds(db({ healthIntervalSeconds: 10, healthRetries: 3 }))).toBe(120);
  });
});
