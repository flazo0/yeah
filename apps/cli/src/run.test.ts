import { describe, expect, test } from "bun:test";
import { run } from "./run";
import { CliError } from "./client";

const env = { YEAH_URL: "https://p.example/", YEAH_TOKEN: "yeah_x", YEAH_TEAM: "t1" };

function fakeFetch(status: number, body: unknown, calls: Array<{ url: string; init?: RequestInit }> = []) {
  return async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: status === 429 ? { "retry-after": "7" } : {} });
  };
}

describe("cli run", () => {
  test("list prints rows and sends the bearer token", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const out = await run(["list", "apps"], env, fakeFetch(200, { applications: [{ id: "a1", name: "web", status: "running" }] }, calls));
    expect(out).toBe("a1\tweb\trunning");
    expect(calls[0]!.url).toBe("https://p.example/teams/t1/ci/applications");
    expect((calls[0]!.init!.headers as Record<string, string>).authorization).toBe("Bearer yeah_x");
  });
  test("deploy --force adds the query", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const out = await run(["deploy", "a1", "--force"], env, fakeFetch(200, { deploymentId: "d1" }, calls));
    expect(out).toContain("d1");
    expect(calls[0]!.url).toEndWith("/applications/a1/deploy?force=true");
  });
  test("surfaces API errors, rate limits and missing env", async () => {
    await expect(run(["backup", "db1"], env, fakeFetch(403, { error: "este token é só leitura" }))).rejects.toThrow("só leitura");
    await expect(run(["list", "apps"], env, fakeFetch(429, {}))).rejects.toThrow("7s");
    await expect(run(["list", "apps"], {}, fakeFetch(200, {}))).rejects.toThrow("YEAH_URL");
    await expect(run(["nope"], env, fakeFetch(200, {}))).rejects.toBeInstanceOf(CliError);
  });
});
