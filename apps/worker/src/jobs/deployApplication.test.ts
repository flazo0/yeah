import { describe, expect, test } from "bun:test";
import type { Application, Server } from "@yeah/db";
import {
  buildCloneOrPullCommand,
  buildHealthWaitCommand,
  buildRunCommand,
  buildStopOldCommand,
  healthWaitSeconds,
  resolveDomain,
} from "./deployApplication.commands";

function makeApplication(overrides: Partial<Application> = {}): Application {
  return {
    id: "app-1",
    teamId: "team-1",
    environmentId: "env-1",
    serverId: "server-1",
    name: "my-api",
    repoUrl: "https://github.com/example/repo",
    branch: "main",
    buildPack: "dockerfile",
    port: 3000,
    envContent: "",
    domain: null,
    githubInstallationId: null,
    githubRepo: null,
    healthPath: null,
    healthIntervalSeconds: 30,
    healthTimeoutSeconds: 5,
    healthRetries: 3,
    healthStartPeriodSeconds: 30,
    dockerOptions: "",
    stopGraceSeconds: 10,
    deployTokenHash: null,
    memoryLimitMb: null,
    cpuLimit: null,
    status: "idle",
    createdAt: new Date(),
    ...overrides,
  };
}

function makeServer(overrides: Partial<Server> = {}): Server {
  return {
    id: "server-1",
    teamId: "team-1",
    name: "prod",
    host: "1.2.3.4",
    port: 22,
    sshUser: "root",
    privateKey: "fake-key",
    status: "connected",
    dockerVersion: null,
    lastCheckedAt: null,
    wildcardDomain: null,
    acmeEmail: null,
    proxyStatus: "inactive",
    cpuPercent: null,
    memPercent: null,
    diskPercent: null,
    metricsCheckedAt: null,
    isPlatformHost: false,
    createdAt: new Date(),
    ...overrides,
  };
}

describe("resolveDomain", () => {
  test("uses the explicit domain when set, regardless of proxy status", () => {
    const app = makeApplication({ domain: "custom.example.com" });
    const server = makeServer({ proxyStatus: "inactive" });
    expect(resolveDomain(app, server)).toBe("custom.example.com");
  });

  test("returns null when there's no domain and no active proxy (publish port directly)", () => {
    const app = makeApplication();
    const server = makeServer({ proxyStatus: "inactive", wildcardDomain: "apps.example.com" });
    expect(resolveDomain(app, server)).toBeNull();
  });

  test("returns null when the proxy is active but has no wildcard domain configured", () => {
    const app = makeApplication();
    const server = makeServer({ proxyStatus: "active", wildcardDomain: null });
    expect(resolveDomain(app, server)).toBeNull();
  });

  test("derives a slug from the app name under the server's wildcard domain", () => {
    const app = makeApplication({ name: "My Cool API!" });
    const server = makeServer({ proxyStatus: "active", wildcardDomain: "apps.example.com" });
    expect(resolveDomain(app, server)).toBe("my-cool-api.apps.example.com");
  });

  test("strips leading/trailing dashes produced by punctuation at the edges of the name", () => {
    const app = makeApplication({ name: "--weird-name--" });
    const server = makeServer({ proxyStatus: "active", wildcardDomain: "apps.example.com" });
    expect(resolveDomain(app, server)).toBe("weird-name.apps.example.com");
  });
});

describe("buildRunCommand", () => {
  test("publishes the port directly when there's no domain", () => {
    const app = makeApplication({ port: 4000 });
    const cmd = buildRunCommand(app, "/opt/yeah-apps/app-1", "yeah-app-1", null);
    expect(cmd).toContain("-p 4000:4000 ");
    expect(cmd).not.toContain("traefik");
  });

  test("uses Traefik labels and the proxy network when a domain is set", () => {
    const app = makeApplication({ port: 4000 });
    const cmd = buildRunCommand(app, "/opt/yeah-apps/app-1", "yeah-app-1", "my-app.example.com");
    expect(cmd).not.toContain("-p 4000:4000");
    expect(cmd).toContain("--network");
    expect(cmd).toContain("traefik.enable=true");
    expect(cmd).toContain("Host(`my-app.example.com`)");
    expect(cmd).toContain("loadbalancer.server.port=4000");
  });

  test("includes resource limit flags when set", () => {
    const app = makeApplication({ memoryLimitMb: 512, cpuLimit: 1.5 });
    const cmd = buildRunCommand(app, "/opt/yeah-apps/app-1", "yeah-app-1", null);
    expect(cmd).toContain("--memory=512m");
    expect(cmd).toContain("--cpus=1.5");
  });

  test("omits resource limit flags entirely when unset", () => {
    const app = makeApplication();
    const cmd = buildRunCommand(app, "/opt/yeah-apps/app-1", "yeah-app-1", null);
    expect(cmd).not.toContain("--memory");
    expect(cmd).not.toContain("--cpus");
  });

  test("quotes the container name and env-file path safely", () => {
    // Container names are derived from a UUID (safe already), but this locks in that the
    // quoting call sites are actually there — a regression here would be a real injection risk.
    const app = makeApplication();
    const cmd = buildRunCommand(app, "/opt/yeah-apps/app-1", "yeah-app-1", null);
    expect(cmd).toContain("--name 'yeah-app-1'");
    expect(cmd).toContain("--env-file '/opt/yeah-apps/app-1/.env'");
  });

  test("mounts a -v flag per configured persistent volume, named after the row id", () => {
    const app = makeApplication();
    const cmd = buildRunCommand(app, "/opt/yeah-apps/app-1", "yeah-app-1", null, [
      { id: "vol-1", mountPath: "/app/uploads" },
      { id: "vol-2", mountPath: "/app/cache" },
    ]);
    expect(cmd).toContain("-v 'yeah-vol-vol-1':'/app/uploads'");
    expect(cmd).toContain("-v 'yeah-vol-vol-2':'/app/cache'");
  });

  test("omits -v flags entirely when there are no volumes", () => {
    const app = makeApplication();
    const cmd = buildRunCommand(app, "/opt/yeah-apps/app-1", "yeah-app-1", null, []);
    expect(cmd).not.toContain("-v ");
  });
});

describe("buildCloneOrPullCommand", () => {
  test("resets to the branch's origin HEAD for a normal deploy (no target commit)", () => {
    const cmd = buildCloneOrPullCommand("/opt/yeah-apps/app-1", "https://github.com/example/repo", "main", null);
    expect(cmd).toContain("git fetch origin 'main'");
    expect(cmd).toContain("git reset --hard 'origin/main'");
    expect(cmd).toContain("git clone --branch 'main' --single-branch");
  });

  test("resets to the exact commit for a rollback, both on the fetch path and the fresh-clone path", () => {
    const sha = "abc123def456";
    const cmd = buildCloneOrPullCommand("/opt/yeah-apps/app-1", "https://github.com/example/repo", "main", sha);
    expect(cmd).not.toContain("origin/main");
    const resetCount = cmd.split(`git reset --hard '${sha}'`).length - 1;
    expect(resetCount).toBe(2);
  });

  test("quotes the clone URL and branch safely", () => {
    const cmd = buildCloneOrPullCommand("/opt/yeah-apps/app-1", "https://x:token@github.com/example/repo", "main", null);
    expect(cmd).toContain("git remote set-url origin 'https://x:token@github.com/example/repo'");
  });
});

describe("healthcheck and docker options in buildRunCommand", () => {
  test("no healthcheck flags without a path", () => {
    const cmd = buildRunCommand(makeApplication(), "/a", "c", null);
    expect(cmd).not.toContain("--health");
  });

  test("healthcheck flags carry path, port and timings", () => {
    const app = makeApplication({ port: 8080, healthPath: "/up", healthIntervalSeconds: 10, healthTimeoutSeconds: 2, healthRetries: 5, healthStartPeriodSeconds: 45 });
    const cmd = buildRunCommand(app, "/a", "c", null);
    expect(cmd).toContain("http://127.0.0.1:8080/up");
    expect(cmd).toContain("http://localhost:8080/up");
    expect(cmd).toContain("--health-interval 10s");
    expect(cmd).toContain("--health-timeout 2s");
    expect(cmd).toContain("--health-retries 5");
    expect(cmd).toContain("--health-start-period 45s");
    expect(cmd).toContain("curl -fsS");
    expect(cmd).toContain("wget -q -O /dev/null");
  });

  test("extra docker options are added as quoted words, never interpreted", () => {
    const app = makeApplication({ dockerOptions: "--cap-add NET_ADMIN --label 'x=$(id)'" });
    const cmd = buildRunCommand(app, "/a", "c", null);
    expect(cmd).toContain("'--cap-add' 'NET_ADMIN' '--label' 'x=$(id)'");
  });

  test("options come before the trailing restart/name so they can't swallow them", () => {
    const app = makeApplication({ dockerOptions: "--shm-size=1g" });
    const cmd = buildRunCommand(app, "/a", "c", null);
    expect(cmd.indexOf("'--shm-size=1g'")).toBeLessThan(cmd.indexOf("--restart unless-stopped"));
  });
});

describe("deploy helpers", () => {
  test("graceful stop uses the configured seconds and then removes", () => {
    const cmd = buildStopOldCommand("yeah-app-1", 25);
    expect(cmd).toContain("docker stop -t 25 'yeah-app-1'");
    expect(cmd).toContain("docker rm -f 'yeah-app-1'");
  });

  test("health wait covers the start period plus every retry plus slack", () => {
    const app = makeApplication({ healthStartPeriodSeconds: 20, healthIntervalSeconds: 10, healthRetries: 3 });
    expect(healthWaitSeconds(app)).toBe(80);
    expect(buildHealthWaitCommand("c", 80)).toContain("seq 1 40");
  });

  test("health wait prints container logs when it fails", () => {
    expect(buildHealthWaitCommand("c", 10)).toContain("docker logs --tail 40 'c'");
  });
});
