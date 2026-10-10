import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Fake Docker API + fake app on local TCP ports: no Docker involved.
const BOOT_MS = 300;
let running = false;
let starts = 0;
let stops = 0;
let appServer: Server | null = null;
let appPort = 0;

function startApp(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(() => {
      appServer = createServer((_req, res) => res.end("hello from app"));
      appServer.listen(appPort, "127.0.0.1", () => resolve());
    }, BOOT_MS);
  });
}

const dockerApi = createServer((req, res) => {
  if (req.method === "GET" && req.url?.endsWith("/json")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ State: { Running: running } }));
  } else if (req.method === "POST" && req.url?.includes("/start")) {
    starts++;
    running = true;
    void startApp().then(() => res.writeHead(204).end());
  } else if (req.method === "POST" && req.url?.includes("/stop")) {
    stops++;
    running = false;
    appServer?.closeAllConnections();
    appServer?.close();
    res.writeHead(204).end();
  } else {
    res.writeHead(404).end();
  }
});

let wakerServer: Server;
let sweep: () => Promise<void>;
let wakerPort = 0;

function get(host: string): Promise<{ status: number; body: string; ms: number }> {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: wakerPort, path: "/", headers: { host }, agent: false }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body, ms: Date.now() - t0 }));
    });
    req.on("error", reject);
    req.end();
  });
}

beforeAll(async () => {
  // reserve a free port for the app
  const probe = createServer();
  await new Promise<void>((r) => probe.listen(0, "127.0.0.1", () => r()));
  appPort = (probe.address() as AddressInfo).port;
  await new Promise<void>((r) => probe.close(() => r()));
  await new Promise<void>((r) => dockerApi.listen(0, "127.0.0.1", () => r()));
  const dockerPort = (dockerApi.address() as AddressInfo).port;

  const dir = mkdtempSync(join(tmpdir(), "waker-"));
  writeFileSync(join(dir, "app1.json"), JSON.stringify({ container: "app1", hosts: ["a.test"], port: appPort, idleSeconds: 1, target: `127.0.0.1:${appPort}` }));
  process.env.WAKER_CONFIG_DIR = dir;
  process.env.DOCKER_URL = `http://127.0.0.1:${dockerPort}`;
  process.env.CHECK_MS = "60000";
  const wakerPath = "./waker.cjs";
  const mod = (await import(wakerPath)) as unknown as { server: Server; sweep: () => Promise<void> };
  wakerServer = mod.server;
  sweep = mod.sweep;
  await new Promise<void>((r) => wakerServer.listen(0, "127.0.0.1", () => r()));
  wakerPort = (wakerServer.address() as AddressInfo).port;
});

afterAll(() => {
  wakerServer.close();
  dockerApi.close();
  appServer?.close();
});

describe("waker", () => {
  test("unknown host is a 404", async () => {
    expect((await get("nope.test")).status).toBe(404);
  });

  test("wakes a stopped app, holding concurrent requests behind one start", async () => {
    expect(running).toBe(false);
    const results = await Promise.all([get("a.test"), get("a.test"), get("a.test")]);
    for (const r of results) {
      expect(r.status).toBe(200);
      expect(r.body).toBe("hello from app");
    }
    expect(starts).toBe(1);
    expect(Math.max(...results.map((r) => r.ms))).toBeGreaterThanOrEqual(BOOT_MS - 50);
  });

  test("a running app answers without another start and without extra delay", async () => {
    const r = await get("a.test");
    expect(r.status).toBe(200);
    expect(starts).toBe(1);
    expect(r.ms).toBeLessThan(BOOT_MS);
  });

  test("does not stop while recently used, stops once idle, then wakes again", async () => {
    await sweep();
    expect(stops).toBe(0);
    await new Promise((r) => setTimeout(r, 1200));
    await sweep();
    expect(stops).toBe(1);
    expect(running).toBe(false);
    const r = await get("a.test");
    expect(r.status).toBe(200);
    expect(starts).toBe(2);
  });
});
