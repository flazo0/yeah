import { describe, expect, test } from "bun:test";
import { ensureWakerCommand, wakeConfigJson, wakerBackendUrl } from "./waker.commands";

describe("waker commands", () => {
  test("wake config carries hosts, port and idle seconds", () => {
    const cfg = JSON.parse(wakeConfigJson("yeah-app-1", ["a.example.com", "b.example.com"], 3000, 15));
    expect(cfg).toEqual({ container: "yeah-app-1", hosts: ["a.example.com", "b.example.com"], port: 3000, idleSeconds: 900 });
  });

  test("backend URL is the waker on the proxy network", () => {
    expect(wakerBackendUrl()).toBe("http://yeah-waker:8080");
  });

  test("ensure command creates the waker once and restarts only when the script changed", () => {
    const cmd = ensureWakerCommand();
    expect(cmd).toContain("docker run -d --name 'yeah-waker'");
    expect(cmd).toContain("--network 'yeah-proxy-net'");
    expect(cmd).toContain("/var/run/docker.sock:/var/run/docker.sock");
    expect(cmd).toContain("cmp -s");
    expect(cmd).toContain("docker restart");
    expect(cmd).toContain("--label traefik.enable=false");
  });
});
