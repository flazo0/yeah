import { describe, expect, test } from "bun:test";
import { syncDomainEnv } from "./serviceDomainEnv";

describe("syncDomainEnv", () => {
  const env = ["SERVICE_FQDN_N8N=localhost", "SERVICE_URL_N8N=http://localhost", "SERVICE_PASSWORD_N8N=abc", "SERVICE_URL_API_3000=http://localhost", "OTHER=1", ""].join("\n");
  test("FQDN gets the bare host, URL gets https, other lines are untouched", () => {
    const out = syncDomainEnv(env, [{ service: "n8n", domain: "flows.example.com", port: 5678 }]);
    expect(out).toContain("SERVICE_FQDN_N8N=flows.example.com");
    expect(out).toContain("SERVICE_URL_N8N=https://flows.example.com");
    expect(out).toContain("SERVICE_PASSWORD_N8N=abc");
    expect(out).toContain("OTHER=1");
  });
  test("a port suffix selects the domain for that port; services without a domain keep their value", () => {
    const out = syncDomainEnv(env, [
      { service: "api", domain: "a.example.com", port: 80 },
      { service: "api", domain: "b.example.com", port: 3000 },
    ]);
    expect(out).toContain("SERVICE_URL_API_3000=https://b.example.com");
    expect(out).toContain("SERVICE_FQDN_N8N=localhost");
  });
  test("service names match ignoring case and dashes", () => {
    expect(syncDomainEnv("SERVICE_FQDN_MY_APP=x", [{ service: "my-app", domain: "z.io", port: 1 }])).toBe("SERVICE_FQDN_MY_APP=z.io");
  });
  test("no domains = unchanged", () => {
    expect(syncDomainEnv(env, [])).toBe(env);
  });
});
