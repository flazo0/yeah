import { describe, expect, test } from "bun:test";
import type { Database } from "@yeah/db";
import { buildRunCommand, containerNameForDatabase } from "./provisionDatabase.commands";

function makeDatabase(overrides: Partial<Database> = {}): Database {
  return {
    id: "db-1",
    teamId: "team-1",
    environmentId: "env-1",
    serverId: "server-1",
    name: "my-db",
    engine: "postgresql",
    image: "postgres:16-alpine",
    port: 5432,
    username: "app",
    password: "s3cr3t",
    databaseName: "app",
    memoryLimitMb: null,
    cpuLimit: null,
    status: "idle",
    createdAt: new Date(),
    ...overrides,
  };
}

describe("containerNameForDatabase", () => {
  test("prefixes the database id", () => {
    expect(containerNameForDatabase("abc-123")).toBe("yeah-db-abc-123");
  });
});

describe("buildRunCommand", () => {
  test("postgresql: maps port 5432, sets standard env vars, mounts the pgdata path", () => {
    const cmd = buildRunCommand(makeDatabase(), "yeah-db-1", "yeah-db-1-data");
    expect(cmd).toContain("-p 5432:5432");
    expect(cmd).toContain("-e POSTGRES_USER='app'");
    expect(cmd).toContain("-e POSTGRES_PASSWORD='s3cr3t'");
    expect(cmd).toContain("-e POSTGRES_DB='app'");
    expect(cmd).toContain("-v 'yeah-db-1-data':/var/lib/postgresql/data");
    expect(cmd).toContain("postgres:16-alpine");
  });

  test("postgresql: falls back to default user/db names when unset", () => {
    const cmd = buildRunCommand(makeDatabase({ username: null, databaseName: null }), "yeah-db-1", "yeah-db-1-data");
    expect(cmd).toContain("-e POSTGRES_USER='postgres'");
    expect(cmd).toContain("-e POSTGRES_DB='app'");
  });

  test("mysql: uses root password env var and port 3306", () => {
    const cmd = buildRunCommand(
      makeDatabase({ engine: "mysql", image: "mysql:8", port: 3306 }),
      "yeah-db-2",
      "yeah-db-2-data",
    );
    expect(cmd).toContain("-e MYSQL_ROOT_PASSWORD='s3cr3t'");
    expect(cmd).toContain("-p 3306:3306");
    expect(cmd).toContain("-v 'yeah-db-2-data':/var/lib/mysql");
  });

  test("mariadb: uses its own env var prefix but the same mysql data path", () => {
    const cmd = buildRunCommand(
      makeDatabase({ engine: "mariadb", image: "mariadb:11", port: 3306 }),
      "yeah-db-3",
      "yeah-db-3-data",
    );
    expect(cmd).toContain("-e MARIADB_ROOT_PASSWORD='s3cr3t'");
    expect(cmd).toContain("-v 'yeah-db-3-data':/var/lib/mysql");
  });

  test("redis: no username/database env vars, password passed as a CLI flag instead", () => {
    const cmd = buildRunCommand(
      makeDatabase({ engine: "redis", image: "redis:7-alpine", port: 6379, username: null, databaseName: null }),
      "yeah-db-4",
      "yeah-db-4-data",
    );
    expect(cmd).not.toContain("-e ");
    expect(cmd).toContain("-p 6379:6379");
    expect(cmd).toContain("-v 'yeah-db-4-data':/data ");
    expect(cmd).toContain("redis-server --requirepass 's3cr3t' --appendonly yes");
  });

  test("mongodb: uses MONGO_INITDB_ROOT_* env vars and defaults username to root", () => {
    const cmd = buildRunCommand(
      makeDatabase({ engine: "mongodb", image: "mongo:7", port: 27017, username: null }),
      "yeah-db-5",
      "yeah-db-5-data",
    );
    expect(cmd).toContain("-e MONGO_INITDB_ROOT_USERNAME='root'");
    expect(cmd).toContain("-v 'yeah-db-5-data':/data/db");
  });

  test("includes resource limit flags when set, regardless of engine", () => {
    const cmd = buildRunCommand(makeDatabase({ memoryLimitMb: 256, cpuLimit: 0.5 }), "yeah-db-1", "yeah-db-1-data");
    expect(cmd).toContain("--memory=256m");
    expect(cmd).toContain("--cpus=0.5");
  });

  test("quotes a password containing a single quote safely for every engine", () => {
    const malicious = "p'; rm -rf / #";
    for (const engine of ["postgresql", "mysql", "mariadb", "redis", "mongodb"] as const) {
      const cmd = buildRunCommand(makeDatabase({ engine, password: malicious }), "yeah-db-1", "yeah-db-1-data");
      expect(cmd).not.toContain(`'${malicious}'`);
      expect(cmd).toContain("rm -rf / #");
    }
  });
});
