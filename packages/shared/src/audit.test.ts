import { describe, expect, test } from "bun:test";
import { describeAuditRequest } from "./audit";

const T = "11111111-1111-4111-8111-111111111111";
const P = "22222222-2222-4222-8222-222222222222";
const E = "33333333-3333-4333-8333-333333333333";
const A = "44444444-4444-4444-8444-444444444444";
const S = "55555555-5555-4555-8555-555555555555";

describe("describeAuditRequest", () => {
  test("ignores reads, failures, other paths and noisy endpoints", () => {
    expect(describeAuditRequest("GET", `/teams/${T}/servers`, 200)).toBeNull();
    expect(describeAuditRequest("POST", `/teams/${T}/servers`, 400)).toBeNull();
    expect(describeAuditRequest("POST", "/auth/login", 200)).toBeNull();
    expect(describeAuditRequest("POST", `/teams/${T}/servers/${S}/terminal`, 200)).toBeNull();
  });

  test("creation, change and deletion of a resource", () => {
    expect(describeAuditRequest("POST", `/teams/${T}/servers`, 201)).toMatchObject({ teamId: T, action: "Criou servidor", resourceType: "server", resourceId: null, level: "info" });
    expect(describeAuditRequest("PUT", `/teams/${T}/servers/${S}`, 200)).toMatchObject({ action: "Alterou servidor", resourceId: S, ids: { server: S } });
    expect(describeAuditRequest("DELETE", `/teams/${T}/servers/${S}`, 200)).toMatchObject({ action: "Excluiu servidor", level: "warning" });
  });

  test("nested application routes resolve the application and its project", () => {
    const base = `/teams/${T}/projects/${P}/environments/${E}/applications/${A}`;
    expect(describeAuditRequest("POST", `${base}/deploy`, 200)).toMatchObject({ action: "Iniciou um deploy", resourceType: "application", resourceId: A, ids: { project: P, application: A } });
    expect(describeAuditRequest("PUT", `${base}/domain`, 200)?.action).toBe("Alterou os domínios");
    expect(describeAuditRequest("POST", `${base}/stop`, 200)?.level).toBe("warning");
    expect(describeAuditRequest("DELETE", base, 200)).toMatchObject({ action: "Excluiu aplicação", level: "warning" });
  });

  test("unknown sub-paths fall back to a readable description", () => {
    const r = describeAuditRequest("PUT", `/teams/${T}/projects/${P}/environments/${E}/applications/${A}/healthcheck`, 200);
    expect(r?.action).toBe("Alterou healthcheck (aplicação)");
  });
});
