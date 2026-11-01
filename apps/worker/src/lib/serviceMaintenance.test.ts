import { describe, expect, test } from "bun:test";
import type { Server, Service } from "@yeah/db";
import { serviceMaintenanceFiles } from "./serviceMaintenance";

const server = { proxyStatus: "active", wildcardDomain: "apps.example.com" } as Server;
const base = { id: "s1", name: "My Blog", domain: null, composeContent: null, domains: [], maintenanceMode: true, maintenanceMessage: "Back <soon>", maintenanceContainers: [] } as unknown as Service;

describe("serviceMaintenanceFiles", () => {
  test("off, or nothing to claim, writes nothing", () => {
    expect(serviceMaintenanceFiles({ ...base, maintenanceMode: false }, server)).toBeNull();
    expect(serviceMaintenanceFiles({ ...base, composeContent: "services: {}", domains: [] }, server)).toBeNull();
  });

  test("a stack in maintenance claims its container domains; the message is carried raw into the wake entry", () => {
    const service = { ...base, composeContent: "services: {}", domains: [{ service: "web", domain: "a.example.com", port: 80 }, { service: "db", domain: "d.example.com", port: 80 }], maintenanceContainers: ["web"] } as unknown as Service;
    const files = serviceMaintenanceFiles(service, server);
    expect(files?.dynamicYaml).toContain("Host(`a.example.com`)");
    expect(files?.dynamicYaml).not.toContain("d.example.com");
    const wake = JSON.parse(files?.wakeJson ?? "{}");
    expect(wake).toMatchObject({ container: "yeah-svc-s1-maint", hosts: ["a.example.com"], idleSeconds: 0, maintenance: { message: "Back <soon>" } });
  });

  test("a legacy service uses its wildcard domain", () => {
    const files = serviceMaintenanceFiles(base, server);
    expect(files?.dynamicYaml).toContain("Host(`my-blog.apps.example.com`)");
  });
});
