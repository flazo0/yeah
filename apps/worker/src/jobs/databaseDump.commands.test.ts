import { describe, expect, test } from "bun:test";
import type { Database } from "@yeah/db";
import { buildDumpCommand, buildRestoreSteps, dumpFileName, includedDatabases, isMultiArchive, isValidIncludedDatabase, plainCopyCommand, supportsMultiDatabase } from "./databaseDump.commands";

function db(overrides: Partial<Database> = {}): Database {
  return {
    id: "db-1",
    teamId: "t",
    environmentId: "e",
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
    status: "running",
    createdAt: new Date(),
    ...overrides,
  };
}

describe("included databases", () => {
  test("validation", () => {
    expect(isValidIncludedDatabase("sales_2024")).toBe(true);
    for (const bad of ["", "a b", "a;b", "a-b", "x".repeat(64), "a`b"]) expect(isValidIncludedDatabase(bad)).toBe(false);
  });
  test("empty list means the resource's own database", () => {
    expect(includedDatabases(db(), null)).toEqual(["app"]);
    expect(includedDatabases(db({ databaseName: "shop" }), "")).toEqual(["shop"]);
  });
  test("a list is deduplicated, split on commas and spaces", () => {
    expect(includedDatabases(db(), "a, b b,a")).toEqual(["a", "b"]);
  });
  test("engines without several databases ignore the list", () => {
    expect(includedDatabases(db({ engine: "redis", databaseName: null }), "x,y")).toEqual(["app"]);
    expect(supportsMultiDatabase("clickhouse")).toBe(false);
    expect(supportsMultiDatabase("mongodb")).toBe(true);
  });
});

describe("dump commands", () => {
  test("a single postgres database goes through the parallel-capable compressor", () => {
    const cmd = buildDumpCommand(db(), "c", "/b/x.sql.gz", ["app"]);
    expect(cmd).toStartWith("GZ=$(command -v pigz || command -v gzip); ");
    expect(cmd).toContain("docker exec 'c' pg_dump -U 'app' 'app' | $GZ > '/b/x.sql.gz'");
  });
  test("several databases are dumped into one tarball", () => {
    const cmd = buildDumpCommand(db(), "c", "/b/x.tar.gz", ["a", "b"]);
    expect(cmd).toContain('pg_dump -U \'app\' \'a\' > "$tmp/a.sql" || exit 1');
    expect(cmd).toContain('pg_dump -U \'app\' \'b\' > "$tmp/b.sql" || exit 1');
    expect(cmd).toContain('tar -cf - -C "$tmp" . | $GZ > \'/b/x.tar.gz\'');
    expect(cmd).toContain('rm -rf "$tmp"');
  });
  test("mongodb single dump uses its own gzip archive; multi uses .archive files", () => {
    expect(buildDumpCommand(db({ engine: "mongodb" }), "c", "/b/x", ["app"])).toContain("--archive --gzip");
    expect(buildDumpCommand(db({ engine: "mongodb" }), "c", "/b/x.tar.gz", ["a", "b"])).toContain('"$tmp/a.archive"');
  });
  test("redis family dumps an rdb, tls-aware", () => {
    expect(buildDumpCommand(db({ engine: "redis", databaseName: null, ssl: true }), "c", "/b/x", ["app"])).toContain("redis-cli --tls --insecure -a 'pw'");
    expect(buildDumpCommand(db({ engine: "keydb", databaseName: null }), "c", "/b/x", ["app"])).toContain("keydb-cli -a 'pw'");
  });
  test("clickhouse backs up into /backups; dragonfly is refused", () => {
    expect(buildDumpCommand(db({ engine: "clickhouse" }), "c", "/opt/yeah-backups/db-1/ch.zip", ["app"])).toContain("/backups/ch.zip");
    expect(() => buildDumpCommand(db({ engine: "dragonfly" }), "c", "/b/x", ["app"])).toThrow();
  });
  test("file names", () => {
    expect(dumpFileName(db(), ["shop"], 1)).toBe("pg-dump-shop-1.sql.gz");
    expect(dumpFileName(db(), ["a", "b"], 1)).toBe("postgresql-dump-multi-1.tar.gz");
    expect(isMultiArchive("/x/a.tar.gz")).toBe(true);
    expect(isMultiArchive("/x/a.sql.gz")).toBe(false);
  });
});

describe("restore steps", () => {
  test("gz or plain files are copied to a plain file first, so a corrupt archive fails the step instead of loading nothing", () => {
    const cmd = plainCopyCommand("/b/x.sql.gz", "/b/x.sql.gz.plain");
    expect(cmd).toContain("1f8b");
    expect(cmd).toContain("gzip -dc '/b/x.sql.gz' > '/b/x.sql.gz.plain'");
    expect(cmd).toContain("cp '/b/x.sql.gz' '/b/x.sql.gz.plain'");
    // gzip writes to a file, never into a pipe (a pipeline would only report its last command's status).
    expect(cmd).not.toMatch(/gzip -dc [^;]*\|/);
  });
  test("postgres: prepare, reset the schema, load from the plain file, clean up", () => {
    const steps = buildRestoreSteps(db(), "c", "/b/x.sql.gz", "v", "/b");
    expect(steps.map((s) => s.label.split(" ")[0])).toEqual(["preparando", "limpando", "carregando", "limpando"]);
    expect(steps[1]!.command).toContain("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    expect(steps[2]!.command).toContain("psql -U 'app' -d 'app' -v ON_ERROR_STOP=1 -q < '/b/x.sql.gz.plain'");
    expect(steps[3]!.allowFailure).toBe(true);
  });
  test("mysql drops and recreates the database as root, re-granting the app user", () => {
    const steps = buildRestoreSteps(db({ engine: "mysql" }), "c", "/b/x.sql.gz", "v", "/b");
    expect(steps[1]!.command).toContain("DROP DATABASE IF EXISTS `app`; CREATE DATABASE `app`; GRANT ALL ON `app`.*");
    expect(steps[2]!.command).toContain("mysql -uroot 'app' < '/b/x.sql.gz.plain'");
  });
  test("mongodb reads mongodump's own archive (--gzip for .gz), tls-aware", () => {
    const [step] = buildRestoreSteps(db({ engine: "mongodb" }), "c", "/b/x.archive.gz", "v", "/b");
    expect(step!.command).toContain("mongorestore --archive --gzip --drop");
    expect(step!.command).toContain("--nsInclude 'app.*'");
    expect(step!.command).toContain("< '/b/x.archive.gz'");
    expect(buildRestoreSteps(db({ engine: "mongodb", ssl: true }), "c", "/b/x.archive", "v", "/b")[0]!.command).toContain("--ssl --sslAllowInvalidCertificates");
    expect(buildRestoreSteps(db({ engine: "mongodb" }), "c", "/b/x.archive", "v", "/b")[0]!.command).not.toContain("--gzip");
  });
  test("a multi-database archive is unpacked and each file restored under its own name, stopping on the first failure", () => {
    const steps = buildRestoreSteps(db(), "c", "/b/x.tar.gz", "v", "/b");
    expect(steps.map((s) => s.label)).toEqual(["abrindo o arquivo de vários bancos", "restaurando cada banco", "limpando temporários"]);
    expect(steps[0]!.command).toContain("tar -xf '/b/x.tar.gz.plain' -C '/b/x.tar.gz.d'");
    expect(steps[1]!.command).toContain('for f in \'/b/x.tar.gz.d\'/*.sql; do n=$(basename "$f" .sql);');
    expect(steps[1]!.command).toContain("CREATE DATABASE");
    expect(steps[1]!.command).toContain("|| exit 1");
  });
  test("redis stops the container, swaps the rdb (dropping the AOF, gunzipping only if gzipped) and starts it again", () => {
    const steps = buildRestoreSteps(db({ engine: "redis", databaseName: null }), "c", "/b/x.rdb.gz", "vol", "/b");
    expect(steps.map((s) => s.command.split(" ").slice(0, 2).join(" "))).toEqual(["docker stop", "docker run", "docker start"]);
    expect(steps[1]!.command).toContain("rm -rf /data/appendonlydir /data/appendonly.aof");
    expect(steps[1]!.command).toContain("1f8b");
    expect(steps[1]!.command).toContain("cp /data/dump.rdb /data/appendonly.aof");
    expect(steps[1]!.command).toContain("-v 'vol':/data");
  });
  test("clickhouse restores from /backups, copying an outside file in first", () => {
    const inside = buildRestoreSteps(db({ engine: "clickhouse" }), "c", "/b/ch.zip", "v", "/b");
    expect(inside).toHaveLength(2);
    expect(inside[1]!.command).toContain("RESTORE DATABASE");
    expect(inside[1]!.command).toContain("/backups/ch.zip");
    const outside = buildRestoreSteps(db({ engine: "clickhouse" }), "c", "/tmp/up.zip", "v", "/b");
    expect(outside[0]!.label).toContain("copiando");
    expect(outside).toHaveLength(3);
  });
});
