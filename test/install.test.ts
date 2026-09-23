import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

// Sources install.sh with YEAH_INSTALL_SOURCE_ONLY=1 (loads render_env and the option parsing, runs
// nothing else) and prints the .env it would generate. Needs a POSIX bash; skipped where there isn't one.
const root = resolve(import.meta.dir, "..");

function bashAvailable(): boolean {
  try {
    return Bun.spawnSync(["bash", "-c", "echo ok"]).stdout.toString().trim() === "ok";
  } catch {
    return false;
  }
}
const maybe = bashAvailable() ? describe : describe.skip;

function renderEnv(extraEnv: Record<string, string> = {}, args = ""): string {
  const proc = Bun.spawnSync(["bash", "-c", `YEAH_INSTALL_SOURCE_ONLY=1 source ./install.sh ${args}; render_env`], {
    cwd: root,
    env: {
      ...process.env,
      PUBLIC_HOST: "panel.example.com",
      WEB_PORT: "58943",
      POSTGRES_PASSWORD: "pgpass",
      SESSION_SECRET: "sess",
      ENCRYPTION_KEY: "enckey",
      LOCALHOST_SSH_PRIVATE_KEY_BASE64: "PRIVKEYB64",
      ...extraEnv,
    },
  });
  if (proc.exitCode !== 0) throw new Error(proc.stderr.toString());
  return proc.stdout.toString();
}

maybe("install.sh render_env", () => {
  test("default mode registers this machine as a deploy target", () => {
    const env = renderEnv();
    expect(env).toContain("LOCALHOST_SSH_PRIVATE_KEY_BASE64=PRIVKEYB64");
    expect(env).toContain("LOCALHOST_SSH_HOST=host.docker.internal");
    expect(env).toContain("WEB_ORIGIN=http://panel.example.com:58943");
    expect(env).not.toContain("COMPOSE_PROFILES");
  });

  test("--control-plane-only writes no localhost SSH settings", () => {
    const env = renderEnv({}, "--control-plane-only");
    expect(env).not.toContain("LOCALHOST_SSH");
    expect(env).not.toContain("PRIVKEYB64");
    expect(env).toContain("Modo \"só painel\"");
    expect(env).toContain("ENCRYPTION_KEY=enckey");
  });

  test("YEAH_CONTROL_PLANE_ONLY=1 behaves like the flag", () => {
    expect(renderEnv({ YEAH_CONTROL_PLANE_ONLY: "1" })).not.toContain("LOCALHOST_SSH");
  });

  test("a tunnel token switches to https origin, local-only port and the tunnel profile", () => {
    const env = renderEnv({}, "--cloudflare-tunnel-token=tok123");
    expect(env).toContain("WEB_ORIGIN=https://panel.example.com\n");
    expect(env).toContain("COMPOSE_PROFILES=tunnel");
    expect(env).toContain("CLOUDFLARE_TUNNEL_TOKEN=tok123");
    expect(env).toContain("TRUST_CF_CONNECTING_IP=1");
    expect(env).toContain("WEB_BIND=127.0.0.1");
  });

  test("both options together", () => {
    const env = renderEnv({}, "--control-plane-only --cloudflare-tunnel-token=tok");
    expect(env).not.toContain("LOCALHOST_SSH");
    expect(env).toContain("CLOUDFLARE_TUNNEL_TOKEN=tok");
  });

  test("an unknown option is rejected", () => {
    const proc = Bun.spawnSync(["bash", "-c", "YEAH_INSTALL_SOURCE_ONLY=1 source ./install.sh --nope"], { cwd: root });
    expect(proc.exitCode).not.toBe(0);
    expect(proc.stderr.toString()).toContain("opção desconhecida");
  });
});
