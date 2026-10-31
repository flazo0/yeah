import { describe, expect, test } from "bun:test";
import { buildLaunchCommand, buildLogTailCommand, FAIL_MARKER, OK_MARKER, PRE_UPDATE_GUARD, REMOTE_LOG_PATH } from "./platformOperation.commands";

describe("buildLaunchCommand", () => {
  test("backgrounds the update and returns immediately", () => {
    const cmd = buildLaunchCommand();
    expect(cmd).toContain("nohup bash -c");
    expect(cmd).toContain("& disown");
    expect(cmd).toContain("echo LAUNCHED");
  });

  test("redirects output to the log file and clears any previous run first", () => {
    const cmd = buildLaunchCommand();
    expect(cmd).toContain(`rm -f '${REMOTE_LOG_PATH}'`);
    expect(cmd).toContain(`> '${REMOTE_LOG_PATH}' 2>&1`);
  });

  test("prints a distinct marker for success vs failure", () => {
    const cmd = buildLaunchCommand();
    expect(cmd).toContain(OK_MARKER);
    expect(cmd).toContain(FAIL_MARKER);
    expect(OK_MARKER).not.toBe(FAIL_MARKER);
  });

  test("chains git fetch/reset before the docker compose rebuild", () => {
    const cmd = buildLaunchCommand();
    expect(cmd).toContain("git fetch --quiet origin");
    expect(cmd).toContain("git reset --hard --quiet origin/main");
    expect(cmd).toContain("docker compose -f docker-compose.prod.yml --env-file .env up -d --build");
    expect(cmd).toContain("db:migrate");
  });
});

describe("PRE_UPDATE_GUARD", () => {
  test("runs first, checks the disk and backs up the database, and can be skipped", () => {
    expect(buildLaunchCommand()).toContain(PRE_UPDATE_GUARD + " && git fetch");
    expect(PRE_UPDATE_GUARD).toContain("df --output=pcent /");
    expect(PRE_UPDATE_GUARD).toContain("pg_dump");
    expect(PRE_UPDATE_GUARD).toContain("YEAH_SKIP_DISK_CHECK");
    expect(PRE_UPDATE_GUARD).toContain("YEAH_BACKUP_BEFORE_UPDATE");
    expect(PRE_UPDATE_GUARD).toContain("tail -n +6");
  });

  test("is valid bash", () => {
    const r = Bun.spawnSync(["bash", "-n", "-c", PRE_UPDATE_GUARD]);
    expect(r.exitCode).toBe(0);
  });
});

describe("buildLogTailCommand", () => {
  test("reads the same log path the launch command writes to, tolerating a missing file", () => {
    const cmd = buildLogTailCommand();
    expect(cmd).toContain(`cat '${REMOTE_LOG_PATH}'`);
    expect(cmd).toContain("|| true");
  });
});
