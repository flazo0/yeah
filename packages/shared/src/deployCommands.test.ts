import { describe, expect, test } from "bun:test";
import { buildPostDeployCommand, buildPreDeployCommand, DEPLOY_COMMAND_MAX_LENGTH, normalizeDeployCommand, preDeployContainerName } from "./deployCommands";

describe("normalizeDeployCommand", () => {
  test("empty or blank means none", () => {
    expect(normalizeDeployCommand("")).toEqual({ ok: true, command: null });
    expect(normalizeDeployCommand("   ")).toEqual({ ok: true, command: null });
    expect(normalizeDeployCommand(null)).toEqual({ ok: true, command: null });
  });
  test("trims and keeps chained commands", () => {
    expect(normalizeDeployCommand("  bun run db:migrate && bun run seed ")).toEqual({ ok: true, command: "bun run db:migrate && bun run seed" });
  });
  test("refuses several lines and control characters", () => {
    expect(normalizeDeployCommand("a\nb").ok).toBe(false);
    expect(normalizeDeployCommand("a\rb").ok).toBe(false);
    expect(normalizeDeployCommand("a\u0000b").ok).toBe(false);
    expect(normalizeDeployCommand("a\tb").ok).toBe(true);
  });
  test("refuses an overlong command", () => {
    expect(normalizeDeployCommand("x".repeat(DEPLOY_COMMAND_MAX_LENGTH)).ok).toBe(true);
    expect(normalizeDeployCommand("x".repeat(DEPLOY_COMMAND_MAX_LENGTH + 1)).ok).toBe(false);
  });
});

describe("buildPreDeployCommand", () => {
  const ctx = { applicationId: "app1", imageRef: "yeah-app-app1", envFile: "/opt/yeah-apps/app1/.env", network: "yeah-env-net", mirrorFlags: "--memory=256m -v 'vol:/data' " };
  const cmd = buildPreDeployCommand("bun run db:migrate", ctx);
  test("runs a throwaway container of the new image with the app's env, network and volumes", () => {
    expect(cmd).toContain("docker run --rm --name 'yeah-predeploy-app1'");
    expect(cmd).toContain("--env-file '/opt/yeah-apps/app1/.env'");
    expect(cmd).toContain("--network 'yeah-env-net'");
    expect(cmd).toContain("--memory=256m -v 'vol:/data'");
    expect(cmd).toContain("'yeah-app-app1'");
  });
  test("uses the shell as the entrypoint so an image ENTRYPOINT does not swallow the command", () => {
    expect(cmd).toContain("--entrypoint sh 'yeah-app-app1' -c 'bun run db:migrate'");
  });
  test("is limited in time and cleans the container up when it does not succeed", () => {
    expect(cmd).toContain("timeout 600 docker run");
    expect(cmd).toContain("docker rm -f 'yeah-predeploy-app1'");
    expect(cmd.endsWith("exit $rc")).toBe(true);
  });
  test("quotes anything the user typed", () => {
    expect(buildPreDeployCommand("echo 'hi' && ls", ctx)).toContain(`-c 'echo '\\''hi'\\'' && ls'`);
    expect(preDeployContainerName("x")).toBe("yeah-predeploy-x");
  });
});

describe("buildPostDeployCommand", () => {
  test("executes inside the running container with a timeout", () => {
    expect(buildPostDeployCommand("php artisan optimize", "yeah-app-1")).toBe("timeout 600 docker exec 'yeah-app-1' sh -c 'php artisan optimize'");
  });
});
