import { describe, expect, test } from "bun:test";
import type { Database } from "@yeah/db";
import { buildRunCommand, healthFlags, healthProbe, sqliteHolderScript } from "./provisionDatabase.commands";
import { buildDumpCommand, buildRestoreSteps, dumpFileName, includedDatabases, supportsMultiDatabase } from "./databaseDump.commands";

function db(overrides: Partial<Database> = {}): Database {
  return {
    id: "db-1",
    teamId: "t",
    environmentId: "env-1",
    serverId: "s",
    name: "my-db",
    engine: "sqlite",
    image: "keinos/sqlite3:latest",
    port: 0,
    username: null,
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
  } as Database;
}

describe("sqlite provisioning", () => {
  const opts = { networkName: "yeah-env-1", alias: "my-db" };

  test("a holder container mounts the data volume, replaces the entrypoint and publishes no port", () => {
    const cmd = buildRunCommand(db(), "c", "vol", opts);
    expect(cmd).toContain("-v 'vol':/data ");
    expect(cmd).toContain("--entrypoint sh");
    expect(cmd).toContain("--restart unless-stopped 'keinos/sqlite3:latest' -c ");
    expect(cmd).not.toContain(" -p ");
    expect(cmd).toContain("--network-alias 'my-db'");
  });
  test("the holder script creates the file, opens the volume up and idles until stopped", () => {
    const script = sqliteHolderScript(db());
    expect(script).toContain("touch '/data/app.db'");
    expect(script).toContain("chmod 777 '/data'");
    expect(script).toContain("trap 'exit 0' TERM INT");
    expect(script).toContain("while :");
  });
  test("a hostile database name cannot leave the data directory", () => {
    expect(sqliteHolderScript(db({ databaseName: "../../etc/x; rm -rf /" }))).toContain("'/data/______etc_x__rm_-rf__.db'");
  });
  test("the health probe queries the file", () => {
    expect(healthProbe(db())).toBe("sqlite3 '/data/app.db' 'SELECT 1;' | grep -q 1");
    expect(healthFlags(db())).toContain("--health-cmd");
    expect(healthFlags(db({ healthEnabled: false }))).toBe("--no-healthcheck ");
  });
});

describe("sqlite backup and restore", () => {
  test("one database, a .sql.gz file", () => {
    expect(supportsMultiDatabase("sqlite")).toBe(false);
    expect(includedDatabases(db(), "a,b")).toEqual(["app"]);
    expect(dumpFileName(db(), ["app"], 5)).toBe("sqlite-dump-app-5.sql.gz");
  });
  test("the dump goes through a temporary file so a failure is not hidden by the compressor", () => {
    const cmd = buildDumpCommand(db(), "c", "/opt/yeah-backups/db-1/x.sql.gz", ["app"]);
    expect(cmd).toContain("docker exec 'c' sqlite3 '/data/app.db' .dump > \"$tmp\"");
    expect(cmd).toContain("$GZ < \"$tmp\" > '/opt/yeah-backups/db-1/x.sql.gz'");
    expect(cmd).toContain("exit $rc");
  });
  test("restore replaces the file (and its WAL files) from the plain dump", () => {
    const steps = buildRestoreSteps(db(), "c", "/b/x.sql.gz", "v", "/b");
    expect(steps.map((s) => s.label)[0]).toBe("preparing the dump");
    const load = steps[1]!.command;
    expect(load).toContain("docker exec -i 'c' sh -c");
    expect(load).toContain("rm -f /data/app.db-wal /data/app.db-shm /data/app.db-journal");
    // a bad dump must keep the existing data: load into a temporary file, swap in only on success
    expect(load).toContain('sqlite3 -safe -bail "$t"');
    expect(load).toContain('mv -f "$t" /data/app.db');
    expect(load.indexOf("sqlite3 -safe -bail")).toBeLessThan(load.indexOf("mv -f"));
    expect(load).not.toMatch(/rm -f \/data\/app\.db /);
    expect(load).toContain("exit $rc");
    expect(load).toContain("< '/b/x.sql.gz.plain'");
    expect(steps[steps.length - 1]!.allowFailure).toBe(true);
  });
});
