import { describe, expect, test } from "bun:test";
import { databaseConnectionUrl, ensureNetworkCommand, environmentNetworkName, internalHostName } from "./databaseConnection";

const base = { host: "db", port: 1, username: "app", password: "p@ss/word", databaseName: "mydb", ssl: false };

describe("databaseConnectionUrl", () => {
  test("postgresql", () => {
    expect(databaseConnectionUrl({ ...base, engine: "postgresql", port: 5432 })).toBe("postgresql://app:p%40ss%2Fword@db:5432/mydb");
    expect(databaseConnectionUrl({ ...base, engine: "postgresql", port: 5432, ssl: true })).toContain("?sslmode=require");
  });
  test("mysql and mariadb share the mysql scheme", () => {
    expect(databaseConnectionUrl({ ...base, engine: "mysql", port: 3306 })).toBe("mysql://app:p%40ss%2Fword@db:3306/mydb");
    expect(databaseConnectionUrl({ ...base, engine: "mariadb", port: 3306, ssl: true })).toContain("ssl-mode=REQUIRED");
  });
  test("mongodb carries authSource and tls", () => {
    expect(databaseConnectionUrl({ ...base, engine: "mongodb", port: 27017 })).toBe("mongodb://app:p%40ss%2Fword@db:27017/mydb?authSource=admin");
    expect(databaseConnectionUrl({ ...base, engine: "mongodb", port: 27017, ssl: true })).toContain("tls=true");
  });
  test("the redis family authenticates as the default user, and rediss:// with tls", () => {
    for (const engine of ["redis", "keydb", "dragonfly"] as const) {
      expect(databaseConnectionUrl({ ...base, engine, username: null, databaseName: null, port: 6379 })).toBe("redis://default:p%40ss%2Fword@db:6379");
      expect(databaseConnectionUrl({ ...base, engine, username: null, databaseName: null, port: 6379, ssl: true })).toStartWith("rediss://");
    }
  });
  test("clickhouse over http(s) with the database in the query", () => {
    expect(databaseConnectionUrl({ ...base, engine: "clickhouse", port: 8123 })).toBe("http://app:p%40ss%2Fword@db:8123/?database=mydb");
  });
});

describe("network helpers", () => {
  test("names", () => {
    expect(environmentNetworkName("abc")).toBe("yeah-env-abc");
    expect(internalHostName("My Postgres DB")).toBe("my-postgres-db");
    expect(internalHostName("###")).toBe("resource");
  });
  test("ensure command never recreates an existing network", () => {
    expect(ensureNetworkCommand("n")).toBe("docker network inspect 'n' >/dev/null 2>&1 || docker network create 'n' >/dev/null");
  });
});
