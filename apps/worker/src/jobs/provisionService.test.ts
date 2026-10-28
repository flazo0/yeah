import { describe, expect, test } from "bun:test";
import type { Server, Service } from "@yeah/db";
import { SERVICE_CATALOG } from "@yeah/shared";
import { buildRunCommand, buildStackPullCommand, buildStackStateCommand, buildStackUpCommand, containerNameForService, everyContainerUp, resolveDomain } from "./provisionService.commands";

function makeService(overrides: Partial<Service> = {}): Service {
  return {
    id: "svc-1",
    teamId: "team-1",
    environmentId: "env-1",
    serverId: "server-1",
    name: "my-service",
    catalogKey: "uptime-kuma",
    image: "louislam/uptime-kuma:1",
    port: 3001,
    envContent: "",
    domain: null,
    composeContent: null,
    templateKey: null,
    mainService: null,
    domains: [],
    lastLog: "",
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
    sshKeyId: null,
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
    metricsEnabled: true,
    cloudflareTunnelToken: null,
    cloudflareTunnelStatus: "inactive",
    cloudflareTunnelError: null,
    trafficAnalyticsEnabled: false,
    patchCheckedAt: null,
    patchUpdates: null,
    patchSecurity: null,
    patchRebootRequired: false,
    patchPackages: null,
    patchNotifiedSecurity: 0,
    autoSecurityUpdates: false,
    isPlatformHost: false,
    sshTimeoutSeconds: 15,
    createdAt: new Date(),
    ...overrides,
  };
}

describe("containerNameForService", () => {
  test("prefixes the service id", () => {
    expect(containerNameForService("abc-123")).toBe("yeah-svc-abc-123");
  });
});

describe("resolveDomain", () => {
  test("uses the explicit domain when set", () => {
    expect(resolveDomain(makeService({ domain: "custom.example.com" }), makeServer())).toBe("custom.example.com");
  });

  test("derives a slug under the wildcard domain when the proxy is active", () => {
    const service = makeService({ name: "My Uptime Kuma!" });
    const server = makeServer({ proxyStatus: "active", wildcardDomain: "apps.example.com" });
    expect(resolveDomain(service, server)).toBe("my-uptime-kuma.apps.example.com");
  });

  test("returns null without a domain and without an active proxy", () => {
    expect(resolveDomain(makeService(), makeServer())).toBeNull();
  });
});

describe("buildRunCommand", () => {
  test("mounts a named volume when the catalog entry declares a volume path", () => {
    const entryWithVolume = SERVICE_CATALOG.find((e) => e.volumePath);
    if (!entryWithVolume) throw new Error("test fixture assumption broken: no catalog entry has a volumePath");

    const service = makeService({ catalogKey: entryWithVolume.key, image: entryWithVolume.image });
    const cmd = buildRunCommand(service, "yeah-svc-1", "/opt/yeah-services/svc-1/.env", null);
    expect(cmd).toContain(`-v 'yeah-svc-1-data':'${entryWithVolume.volumePath}'`);
  });

  test("omits the volume flag for a catalog entry with no volumePath", () => {
    const entryWithoutVolume = SERVICE_CATALOG.find((e) => !e.volumePath);
    if (!entryWithoutVolume) throw new Error("test fixture assumption broken: every catalog entry has a volumePath");

    const service = makeService({ catalogKey: entryWithoutVolume.key, image: entryWithoutVolume.image });
    const cmd = buildRunCommand(service, "yeah-svc-1", "/opt/yeah-services/svc-1/.env", null);
    expect(cmd).not.toContain("-data'");
  });

  test("publishes the port directly with no domain", () => {
    const cmd = buildRunCommand(makeService({ port: 3001 }), "yeah-svc-1", "/opt/env", null);
    expect(cmd).toContain("-p 3001:3001");
    expect(cmd).not.toContain("traefik");
  });

  test("uses Traefik labels when a domain is resolved", () => {
    const cmd = buildRunCommand(makeService({ port: 3001 }), "yeah-svc-1", "/opt/env", "kuma.example.com");
    expect(cmd).toContain("Host(`kuma.example.com`)");
    expect(cmd).toContain("loadbalancer.server.port=3001");
  });

  test("includes resource limit flags when set", () => {
    const cmd = buildRunCommand(makeService({ memoryLimitMb: 128, cpuLimit: 0.25 }), "yeah-svc-1", "/opt/env", null);
    expect(cmd).toContain("--memory=128m");
    expect(cmd).toContain("--cpus=0.25");
  });

  test("falls back gracefully for an unknown catalogKey (no volume, no crash)", () => {
    const cmd = buildRunCommand(makeService({ catalogKey: "not-a-real-catalog-entry" }), "yeah-svc-1", "/opt/env", null);
    expect(cmd).not.toContain("-data'");
    expect(cmd).toContain("docker run");
  });
});

describe("stack commands", () => {
  test("up waits for the whole project, using the generated override", () => {
    const cmd = buildStackUpCommand("svc-1", 120);
    expect(cmd).toContain("cd '/opt/yeah-services/svc-1' && docker compose -p 'yeah-svc-svc-1' --env-file .env -f docker-compose.yml -f compose.yeah.override.yml");
    expect(cmd).toContain("up -d --remove-orphans --wait --wait-timeout 120");
    expect(buildStackUpCommand("svc-1", 5)).toContain("--wait-timeout 30");
  });
  test("pull runs before, without the override (it only needs the images)", () => {
    const cmd = buildStackPullCommand("svc-1");
    expect(cmd).toContain("pull --quiet");
    expect(cmd).not.toContain("override");
  });
});

describe("unhealthy-but-running stacks", () => {
  const lines = (...l: string[]) => l.join("\n");
  test("the state command lists every container of the compose project, stopped ones included", () => {
    const cmd = buildStackStateCommand("svc-1");
    expect(cmd).toContain("docker ps -a");
    expect(cmd).toContain("com.docker.compose.project=yeah-svc-svc-1");
  });
  test("counts as up only when every container is running (or restarting)", () => {
    expect(everyContainerUp(lines("a|running", "b|running", ""))).toBe(true);
    expect(everyContainerUp(lines("a|running", "b|restarting", ""))).toBe(true);
    expect(everyContainerUp(lines("a|running", "b|exited", ""))).toBe(false);
    expect(everyContainerUp(lines("a|created", ""))).toBe(false);
    expect(everyContainerUp("")).toBe(false);
  });
});
