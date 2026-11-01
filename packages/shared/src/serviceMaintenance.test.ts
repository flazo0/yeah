import { describe, expect, test } from "bun:test";
import { removeServiceMaintenanceCommand, sanitizeMaintenanceContainers, serviceMaintenanceDynamicConfig, serviceMaintenanceHosts, serviceMaintenanceName } from "./serviceMaintenance";

const domains = [
  { service: "web", domain: "app.example.com", port: 80 },
  { service: "api", domain: "api.example.com", port: 3000 },
  { service: "web", domain: "www.example.com", port: 80 },
];

describe("service maintenance", () => {
  test("a stack puts every domain into maintenance unless containers are selected", () => {
    expect(serviceMaintenanceHosts({ domain: null, domains, containers: [], isStack: true })).toEqual(["app.example.com", "api.example.com", "www.example.com"]);
    expect(serviceMaintenanceHosts({ domain: null, domains, containers: ["web"], isStack: true })).toEqual(["app.example.com", "www.example.com"]);
    expect(serviceMaintenanceHosts({ domain: null, domains, containers: ["db"], isStack: true })).toEqual([]);
  });

  test("a legacy single-container service uses its resolved domain", () => {
    expect(serviceMaintenanceHosts({ domain: "s.example.com", domains: [], containers: ["x"], isStack: false })).toEqual(["s.example.com"]);
    expect(serviceMaintenanceHosts({ domain: null, domains: [], containers: [], isStack: false })).toEqual([]);
  });

  test("container names are filtered to the stack's services", () => {
    expect(sanitizeMaintenanceContainers(["web", "web", "ghost"], ["web", "api"])).toEqual(["web"]);
  });

  test("dynamic config claims the hosts at high priority and forwards them to the waker", () => {
    const yaml = serviceMaintenanceDynamicConfig("abc", ["a.example.com", "b.example.com"]) as string;
    expect(yaml).toContain(`${serviceMaintenanceName("abc")}:`);
    expect(yaml).toContain("Host(`a.example.com`) || Host(`b.example.com`)");
    expect(yaml).toContain("priority: 1000");
    expect(yaml).toContain('- url: "http://yeah-waker:8080"');
    expect(serviceMaintenanceDynamicConfig("abc", [])).toBeNull();
  });

  test("the remove command deletes the router file and the waker entry", () => {
    const cmd = removeServiceMaintenanceCommand("abc");
    expect(cmd).toContain("/dynamic/yeah-svc-abc-maint.yml");
    expect(cmd).toContain("/wake/yeah-svc-abc-maint.json");
    expect(cmd.startsWith("rm -f ")).toBe(true);
  });
});
