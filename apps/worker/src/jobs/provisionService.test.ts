import { describe, expect, test } from "bun:test";
import type { Server, Service } from "@yeah/db";
import { SERVICE_CATALOG } from "@yeah/shared";
import { buildRunCommand, containerNameForService, resolveDomain } from "./provisionService.commands";

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
