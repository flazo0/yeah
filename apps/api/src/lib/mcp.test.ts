import { describe, expect, test } from "bun:test";
import { handleMcp, type McpOps } from "./mcp";

const calls: string[] = [];
const ops: McpOps = {
  listApplications: async () => [{ id: "a1" }],
  listDatabases: async () => [],
  listServices: async () => [],
  listDeployments: async () => ({ ok: true, value: [] }),
  deploy: async (id) => (calls.push(`deploy:${id}`), { ok: true, value: { deploymentId: "d1" } }),
  backup: async () => ({ ok: false, status: 404, error: "database not found" }),
};
const rpc = (method: string, params?: Record<string, unknown>) => ({ jsonrpc: "2.0", id: 1, method, params });

describe("handleMcp", () => {
  test("initialize and notifications", async () => {
    const res = (await handleMcp(rpc("initialize"), ops, false)) as { result: { serverInfo: { name: string } } };
    expect(res.result.serverInfo.name).toBe("yeah");
    expect(await handleMcp({ jsonrpc: "2.0", method: "notifications/initialized" }, ops, false)).toBeNull();
  });
  test("read-only hides and rejects write tools", async () => {
    const list = (await handleMcp(rpc("tools/list"), ops, true)) as { result: { tools: { name: string }[] } };
    expect(list.result.tools.map((t) => t.name)).not.toContain("deploy_application");
    const call = (await handleMcp(rpc("tools/call", { name: "deploy_application", arguments: { applicationId: "a1" } }), ops, true)) as { result: { isError: boolean } };
    expect(call.result.isError).toBe(true);
    expect(calls).toEqual([]);
  });
  test("write token can deploy; action errors surface as tool errors", async () => {
    const call = (await handleMcp(rpc("tools/call", { name: "deploy_application", arguments: { applicationId: "a1" } }), ops, false)) as { result: { isError: boolean } };
    expect(call.result.isError).toBe(false);
    expect(calls).toEqual(["deploy:a1"]);
    const bad = (await handleMcp(rpc("tools/call", { name: "backup_database", arguments: { databaseId: "x" } }), ops, false)) as { result: { isError: boolean } };
    expect(bad.result.isError).toBe(true);
  });
  test("resources, prompts and unknown methods", async () => {
    const r = (await handleMcp(rpc("resources/read", { uri: "yeah://applications" }), ops, true)) as { result: { contents: { text: string }[] } };
    expect(r.result.contents[0]!.text).toContain("a1");
    const p = (await handleMcp(rpc("prompts/get", { name: "debug_deploy", arguments: { applicationId: "a1" } }), ops, true)) as { result: { messages: unknown[] } };
    expect(p.result.messages).toHaveLength(1);
    const e = (await handleMcp(rpc("nope"), ops, false)) as { error: { code: number } };
    expect(e.error.code).toBe(-32601);
  });
});
