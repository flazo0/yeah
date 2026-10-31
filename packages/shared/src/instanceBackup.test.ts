import { describe, expect, test } from "bun:test";
import { buildInstanceDumpCommand, instanceBackupKey, instanceBackupsToDelete, isInstanceBackupDue, validateInstanceBackupSettings } from "./instanceBackup";

const at = (iso: string) => new Date(iso);
const base = { enabled: true, storageId: "s1", hourUtc: 3, lastAt: null as Date | null };

describe("isInstanceBackupDue", () => {
  test("only inside the chosen UTC hour", () => {
    expect(isInstanceBackupDue(at("2026-11-01T03:15:00Z"), base)).toBe(true);
    expect(isInstanceBackupDue(at("2026-11-01T04:00:00Z"), base)).toBe(false);
    expect(isInstanceBackupDue(at("2026-11-01T02:59:00Z"), base)).toBe(false);
  });
  test("not twice in the same day, even though the tick runs several times in the hour", () => {
    expect(isInstanceBackupDue(at("2026-11-01T03:30:00Z"), { ...base, lastAt: at("2026-11-01T03:05:00Z") })).toBe(false);
    expect(isInstanceBackupDue(at("2026-11-02T03:05:00Z"), { ...base, lastAt: at("2026-11-01T03:05:00Z") })).toBe(true);
  });
  test("a missed day is made up for the next day, not repeated at once", () => {
    expect(isInstanceBackupDue(at("2026-11-05T03:00:00Z"), { ...base, lastAt: at("2026-11-01T03:05:00Z") })).toBe(true);
  });
  test("disabled or without a destination: never on schedule", () => {
    expect(isInstanceBackupDue(at("2026-11-01T03:15:00Z"), { ...base, enabled: false })).toBe(false);
    expect(isInstanceBackupDue(at("2026-11-01T03:15:00Z"), { ...base, storageId: null })).toBe(false);
  });
  test("back up now ignores the hour and the switch, but still needs a destination", () => {
    expect(isInstanceBackupDue(at("2026-11-01T12:00:00Z"), { ...base, enabled: false }, true)).toBe(true);
    expect(isInstanceBackupDue(at("2026-11-01T12:00:00Z"), { ...base, storageId: null }, true)).toBe(false);
  });
});

describe("validateInstanceBackupSettings", () => {
  test("accepts sane values and refuses the rest", () => {
    expect(validateInstanceBackupSettings(3, 7)).toBeNull();
    expect(validateInstanceBackupSettings(24, 7)).not.toBeNull();
    expect(validateInstanceBackupSettings(-1, 7)).not.toBeNull();
    expect(validateInstanceBackupSettings(3, 0)).not.toBeNull();
    expect(validateInstanceBackupSettings(3, 91)).not.toBeNull();
    expect(validateInstanceBackupSettings(3.5, 7)).not.toBeNull();
  });
});

describe("keys and retention", () => {
  test("the key carries the UTC time and sorts chronologically", () => {
    expect(instanceBackupKey(at("2026-11-01T03:05:09Z"))).toBe("yeah-instance/yeah-20261101-030509.sql.gz");
    expect(instanceBackupKey(at("2026-11-01T03:05:09Z")) < instanceBackupKey(at("2026-11-02T00:00:00Z"))).toBe(true);
  });
  test("keeps the newest N and removes the older ones", () => {
    const keys = [1, 2, 3, 4, 5].map((d) => instanceBackupKey(at(`2026-11-0${d}T03:00:00Z`)));
    expect(instanceBackupsToDelete(keys, 3)).toEqual([keys[1]!, keys[0]!]);
    expect(instanceBackupsToDelete(keys, 10)).toEqual([]);
  });
  test("never touches an object that is not one of ours", () => {
    const ours = instanceBackupKey(at("2026-11-01T03:00:00Z"));
    expect(instanceBackupsToDelete(["notes.txt", "yeah-instance/readme.md", "other/yeah-20260101-000000.sql.gz", ours], 0)).toEqual([ours]);
  });
});

describe("buildInstanceDumpCommand", () => {
  const cmd = buildInstanceDumpCommand("/opt/yeah", "/opt/yeah-backups/instance/yeah-1.sql.gz");
  test("dumps inside the postgres container with its own credentials", () => {
    expect(cmd).toContain("docker compose -f docker-compose.prod.yml --env-file .env exec -T postgres");
    expect(cmd).toContain("$POSTGRES_USER");
    expect(cmd).toContain("pg_dump");
  });
  test("fails on a broken pipe, an empty or damaged archive, and moves it into place only then", () => {
    expect(cmd).toContain("pipefail");
    expect(cmd).toContain("gzip -t");
    expect(cmd.indexOf("gzip -t")).toBeLessThan(cmd.indexOf("mv "));
    expect(cmd).toContain("-gt 200");
  });
  test("removes the partial file when anything fails", () => {
    expect(cmd).toContain("rm -f");
    expect(cmd).toContain(".partial");
  });
});
