import { describe, expect, test } from "bun:test";
import type { Application, Server } from "@yeah/db";
import { buildRunCommand, resolveDomain } from "./deployApplication.commands";

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
});
