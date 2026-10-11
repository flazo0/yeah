"use strict";
// yeah-waker — scale-to-zero reverse proxy. Runs on the managed server (node:22-alpine, no deps).
// Traefik routes an app's domain here instead of to the app. For each request the waker:
//   1. finds the app by Host header (config files in WAKER_CONFIG_DIR, one JSON per app),
//   2. starts the container if it is stopped and waits until its port accepts connections —
//      the HTTP request is simply held meanwhile, so the visitor sees a slower first response, no loading page,
//   3. forwards the request (and WebSocket upgrades) and remembers when it last saw traffic,
//   4. stops containers that were idle longer than their idleSeconds.
// Config file: { "container": "yeah-app-<id>", "hosts": ["a.example.com"], "port": 3000, "idleSeconds": 600, "target": "optional host:port" }
// The waker only needs the Docker API (unix socket, or DOCKER_URL=http://host:port for tests).
const http = require("http");
const net = require("net");
const fs = require("fs");
const path = require("path");

const CONFIG_DIR = process.env.WAKER_CONFIG_DIR || "/wake";
const LISTEN_PORT = Number(process.env.WAKER_PORT || 8080);
const DOCKER_SOCKET = process.env.DOCKER_SOCKET || "/var/run/docker.sock";
const DOCKER_URL = process.env.DOCKER_URL || "";
const WAKE_TIMEOUT_MS = Number(process.env.WAKE_TIMEOUT_MS || 60000);
const SWEEP_MS = Number(process.env.SWEEP_MS || 15000);
const CHECK_MS = Number(process.env.CHECK_MS || 5000);

/** @type {Map<string, any>} container name -> state */
const apps = new Map();
let hostIndex = new Map();
let lastLoad = 0;

function log(msg) {
  console.log(JSON.stringify({ time: new Date().toISOString(), service: "waker", msg }));
}

function loadConfig() {
  const now = Date.now();
  if (now - lastLoad < 2000) return;
  lastLoad = now;
  let files = [];
  try {
    files = fs.readdirSync(CONFIG_DIR).filter((f) => f.endsWith(".json"));
  } catch {
    files = [];
  }
  const seen = new Set();
  const index = new Map();
  for (const file of files) {
    let cfg;
    try {
      cfg = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, file), "utf8"));
    } catch {
      continue;
    }
    if (!cfg || typeof cfg.container !== "string" || !Array.isArray(cfg.hosts) || !cfg.port) continue;
    seen.add(cfg.container);
    let state = apps.get(cfg.container);
    if (!state) {
      state = { up: false, checkedAt: 0, last: now, inflight: 0, waking: null };
      apps.set(cfg.container, state);
    }
    state.cfg = cfg;
    for (const h of cfg.hosts) index.set(String(h).toLowerCase(), state);
  }
  for (const name of [...apps.keys()]) if (!seen.has(name)) apps.delete(name);
  hostIndex = index;
}

function docker(method, apiPath) {
  return new Promise((resolve, reject) => {
    const options = { method, path: apiPath };
    if (DOCKER_URL) {
      const u = new URL(DOCKER_URL);
      options.host = u.hostname;
      options.port = Number(u.port);
    } else {
      options.socketPath = DOCKER_SOCKET;
    }
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end();
  });
}

function targetOf(cfg) {
  if (cfg.target) {
    const i = cfg.target.lastIndexOf(":");
    return { host: cfg.target.slice(0, i), port: Number(cfg.target.slice(i + 1)) };
  }
  return { host: cfg.container, port: Number(cfg.port) };
}

function canConnect(target) {
  return new Promise((resolve) => {
    const socket = net.connect(target.port, target.host);
    socket.setTimeout(1000);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

async function waitForPort(target) {
  const deadline = Date.now() + WAKE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await canConnect(target)) return;
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error("the app did not accept connections in time");
}

/** Makes sure the container runs and its port answers. Concurrent callers share one wake-up. */
function ensureUp(state) {
  const now = Date.now();
  if (state.up && now - state.checkedAt < CHECK_MS) return Promise.resolve();
  if (state.waking) return state.waking;
  const name = state.cfg.container;
  state.waking = (async () => {
    const info = await docker("GET", "/containers/" + encodeURIComponent(name) + "/json");
    if (info.status === 404) throw new Error("container " + name + " does not exist");
    const running = JSON.parse(info.body).State.Running === true;
    if (!running) {
      const started = Date.now();
      const res = await docker("POST", "/containers/" + encodeURIComponent(name) + "/start");
      if (res.status !== 204 && res.status !== 304) throw new Error("docker start failed: " + res.status + " " + res.body);
      await waitForPort(targetOf(state.cfg));
      log("woke " + name + " in " + (Date.now() - started) + "ms");
    }
    state.up = true;
    state.checkedAt = Date.now();
  })().finally(() => {
    state.waking = null;
  });
  return state.waking;
}

function fail(res, status, message) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(message);
}

const server = http.createServer(async (req, res) => {
  if (req.url === "/__waker") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }
  loadConfig();
  const host = String(req.headers.host || "").split(":")[0].toLowerCase();
  const state = hostIndex.get(host);
  if (!state) return fail(res, 404, "no app configured for this host");
  state.last = Date.now();
  state.inflight++;
  let finished = false;
  const done = () => {
    if (finished) return;
    finished = true;
    state.inflight--;
    state.last = Date.now();
  };
  res.on("close", done);
  try {
    await ensureUp(state);
  } catch (err) {
    log("wake failed for " + state.cfg.container + ": " + err.message);
    state.up = false;
    return fail(res, 504, "the app could not be started: " + err.message);
  }
  const target = targetOf(state.cfg);
  const upstream = http.request({ host: target.host, port: target.port, method: req.method, path: req.url, headers: req.headers }, (up) => {
    res.writeHead(up.statusCode || 502, up.headers);
    up.pipe(res);
  });
  upstream.on("error", (err) => {
    state.up = false;
    fail(res, 502, "the app did not answer: " + err.message);
  });
  req.on("aborted", () => upstream.destroy());
  req.pipe(upstream);
});

server.on("upgrade", async (req, socket, head) => {
  loadConfig();
  const host = String(req.headers.host || "").split(":")[0].toLowerCase();
  const state = hostIndex.get(host);
  if (!state) {
    socket.end("HTTP/1.1 404 Not Found\r\n\r\n");
    return;
  }
  state.inflight++;
  let finished = false;
  const done = () => {
    if (finished) return;
    finished = true;
    state.inflight--;
    state.last = Date.now();
  };
  socket.on("close", done);
  try {
    await ensureUp(state);
  } catch {
    socket.end("HTTP/1.1 504 Gateway Timeout\r\n\r\n");
    return;
  }
  const target = targetOf(state.cfg);
  const upstream = net.connect(target.port, target.host, () => {
    let raw = req.method + " " + req.url + " HTTP/1.1\r\n";
    for (let i = 0; i < req.rawHeaders.length; i += 2) raw += req.rawHeaders[i] + ": " + req.rawHeaders[i + 1] + "\r\n";
    upstream.write(raw + "\r\n");
    if (head && head.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
});

async function sweep() {
  loadConfig();
  const now = Date.now();
  for (const state of apps.values()) {
    if (!state.up || state.waking || state.inflight > 0) continue;
    const idleMs = Number(state.cfg.idleSeconds || 600) * 1000;
    if (now - state.last < idleMs) continue;
    try {
      await docker("POST", "/containers/" + encodeURIComponent(state.cfg.container) + "/stop?t=10");
      state.up = false;
      log("slept " + state.cfg.container + " after " + Math.round((now - state.last) / 1000) + "s idle");
    } catch (err) {
      log("stop failed for " + state.cfg.container + ": " + err.message);
    }
  }
}

if (require.main === module) {
  loadConfig();
  // A restarted waker does not know which apps are running: treat them as running and idle-from-now, so
  // they get stopped after one idle period; apps that are already stopped are woken by the next request.
  for (const state of apps.values()) state.up = true;
  server.listen(LISTEN_PORT, () => log("listening on " + LISTEN_PORT));
  setInterval(() => void sweep(), SWEEP_MS).unref();
  process.on("SIGTERM", () => process.exit(0));
}

module.exports = { server, sweep, loadConfig };
