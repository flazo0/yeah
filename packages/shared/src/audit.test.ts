import { describe, expect, test } from "bun:test";
import { describeAuditRequest, describeAuthEvent } from "./audit";

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
    expect(describeAuditRequest("POST", `/teams/${T}/servers`, 201)).toMatchObject({ teamId: T, action: "Created server", resourceType: "server", resourceId: null, level: "info" });
    expect(describeAuditRequest("PUT", `/teams/${T}/servers/${S}`, 200)).toMatchObject({ action: "Changed server", resourceId: S, ids: { server: S } });
    expect(describeAuditRequest("DELETE", `/teams/${T}/servers/${S}`, 200)).toMatchObject({ action: "Deleted server", level: "warning" });
  });

  test("nested application routes resolve the application and its project", () => {
    const base = `/teams/${T}/projects/${P}/environments/${E}/applications/${A}`;
    expect(describeAuditRequest("POST", `${base}/deploy`, 200)).toMatchObject({ action: "Started a deployment", resourceType: "application", resourceId: A, ids: { project: P, application: A } });
    expect(describeAuditRequest("PUT", `${base}/domain`, 200)?.action).toBe("Changed the domains");
    expect(describeAuditRequest("POST", `${base}/stop`, 200)?.level).toBe("warning");
    expect(describeAuditRequest("DELETE", base, 200)).toMatchObject({ action: "Deleted application", level: "warning" });
  });

  test("unknown sub-paths fall back to a readable description", () => {
    const r = describeAuditRequest("PUT", `/teams/${T}/projects/${P}/environments/${E}/applications/${A}/healthcheck`, 200);
    expect(r?.action).toBe("Changed healthcheck (application)");
  });

  test("the versioned token API is recorded like the team routes", () => {
    const r = describeAuditRequest("POST", `/api/v1/teams/${T}/applications/${A}/deploy`, 202);
    expect(r).toMatchObject({ teamId: T, action: "Started a deployment", resourceType: "application", resourceId: A });
    expect(describeAuditRequest("GET", `/api/v1/teams/${T}/applications`, 200)).toBeNull();
    expect(describeAuditRequest("POST", "/api/v1/other", 200)).toBeNull();
  });

  test("moving a resource through the token API has a readable action", () => {
    expect(describeAuditRequest("POST", `/teams/${T}/ci/move-resource`, 200)?.action).toBe("Moved a resource to another environment");
  });

  test("the MCP endpoint is skipped (its mutating tools are recorded by the route)", () => {
    expect(describeAuditRequest("POST", `/teams/${T}/mcp`, 200)).toBeNull();
  });
});

describe("file browser writes", () => {
  const E = "22222222-2222-4222-8222-222222222222";
  const base = `/teams/${T}/projects/${E}/environments/${E}`;
  test("each write has a readable action and never mentions a path", () => {
    expect(describeAuditRequest("PUT", `${base}/databases/${E}/file-save`, 200)).toMatchObject({ action: "Edited a file in the container", resourceType: "database", level: "info" });
    expect(describeAuditRequest("POST", `${base}/services/${E}/file-upload`, 200)).toMatchObject({ action: "Uploaded a file to the container", resourceType: "service" });
    expect(describeAuditRequest("POST", `${base}/applications/${E}/file-mkdir`, 200)).toMatchObject({ action: "Created a folder in the container" });
    expect(describeAuditRequest("POST", `${base}/applications/${E}/file-delete`, 200)).toMatchObject({ action: "Deleted a file or folder in the container", level: "warning" });
  });
});

describe("describeAuthEvent", () => {
  test("successful events are info, failures are warnings", () => {
    expect(describeAuthEvent("sign-in")).toEqual({ action: "Signed in", level: "info" });
    expect(describeAuthEvent("sign-in-passkey").level).toBe("info");
    expect(describeAuthEvent("sign-out").level).toBe("info");
    expect(describeAuthEvent("sign-in-failed").level).toBe("warning");
    expect(describeAuthEvent("second-factor-failed").level).toBe("warning");
  });
});
