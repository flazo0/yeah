import { describe, expect, test } from "bun:test";
import { databaseConnectionUrl, databaseDataVolumeName, isValidSqliteName, sqliteConnectionUrl, sqliteFileName, sqliteFilePath } from "./databaseConnection";
import { setEnvVariable } from "./env";
import { DATABASE_ENGINES, volumeFlags } from "./types";

describe("sqlite file naming", () => {
  test("a safe name is used as is, anything else is sanitised", () => {
    expect(sqliteFileName("app")).toBe("app.db");
    expect(sqliteFileName("my db/../x")).toBe("my_db____x.db");
    expect(sqliteFileName(null)).toBe("app.db");
    expect(sqliteFileName("")).toBe("app.db");
    expect(sqliteFileName("a".repeat(100))).toBe(`${"a".repeat(63)}.db`);
  });
  test("paths and URLs", () => {
    expect(sqliteFilePath("app")).toBe("/data/app.db");
    expect(sqliteConnectionUrl("app")).toBe("file:/data/app.db");
    expect(sqliteConnectionUrl("app", "/var/lib/db/")).toBe("file:/var/lib/db/app.db");
    expect(databaseConnectionUrl({ engine: "sqlite", host: "x", port: 0, username: null, password: "p", databaseName: "app", ssl: false })).toBe("file:/data/app.db");
  });
  test("validation", () => {
    expect(isValidSqliteName("my-db_1")).toBe(true);
    expect(isValidSqliteName("../etc")).toBe(false);
    expect(isValidSqliteName("")).toBe(false);
  });
  test("data volume name matches the one the provisioning job creates", () => {
    expect(databaseDataVolumeName("abc")).toBe("yeah-db-abc-data");
  });
});

describe("sqlite catalog entry", () => {
  test("is file based, with no port, TLS or user", () => {
    const info = DATABASE_ENGINES.sqlite;
    expect(info.fileBased).toBe(true);
    expect(info.supportsSsl).toBe(false);
    expect(info.supportsBackup).toBe(true);
    expect(info.hasUsername).toBe(false);
  });
  test("no other engine is file based", () => {
    for (const [key, info] of Object.entries(DATABASE_ENGINES)) if (key !== "sqlite") expect(info.fileBased).toBeFalsy();
  });
});

describe("database volume mounts", () => {
  test("mounts the database's own named volume", () => {
    expect(volumeFlags([{ id: "v1", mountPath: "/data", kind: "database", hostPath: "yeah-db-abc-data" }])).toBe("-v 'yeah-db-abc-data':'/data' ");
  });
  test("without a volume name nothing database-specific is mounted by name", () => {
    expect(volumeFlags([{ id: "v1", mountPath: "/data", kind: "database", hostPath: null }])).toBe("-v 'yeah-vol-v1':'/data' ");
  });
});

describe("setEnvVariable", () => {
  test("appends to empty content and to existing content", () => {
    expect(setEnvVariable("", "DATABASE_URL", "file:/data/app.db")).toBe("DATABASE_URL=file:/data/app.db\n");
    expect(setEnvVariable("A=1\n", "DATABASE_URL", "x")).toBe("A=1\nDATABASE_URL=x\n");
  });
  test("replaces an existing line in place, whatever its prefix, and keeps comments", () => {
    expect(setEnvVariable("# note\nA=1\nbuild:DATABASE_URL=old\nB=2\n", "DATABASE_URL", "new")).toBe("# note\nA=1\nDATABASE_URL=new\nB=2\n");
  });
  test("does not touch a variable that merely starts with the key", () => {
    expect(setEnvVariable("DATABASE_URL_X=1\n", "DATABASE_URL", "n")).toBe("DATABASE_URL_X=1\nDATABASE_URL=n\n");
  });
});
