import { describe, expect, test } from "bun:test";
import { createHetznerServer, HetznerError } from "./hetzner";

const input = { apiToken: "tok", name: "app1", serverType: "cx22", location: "nbg1", image: "ubuntu-24.04", sshPublicKey: "ssh-ed25519 AAAA yeah\n" };

describe("createHetznerServer", () => {
  test("registers key, firewall then server, and returns the IPv4", async () => {
    const calls: Array<{ url: string; body: any; auth: string }> = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      const body = JSON.parse(init!.body as string);
      calls.push({ url, body, auth: (init!.headers as Record<string, string>).authorization! });
      if (url.endsWith("/ssh_keys")) return Response.json({ ssh_key: { id: 11 } });
      if (url.endsWith("/firewalls")) return Response.json({ firewall: { id: 22 } });
      return Response.json({ server: { id: 33, public_net: { ipv4: { ip: "203.0.113.9" } } } });
    };
    const result = await createHetznerServer(input, fetchImpl);
    expect(result).toEqual({ hetznerServerId: 33, ipv4: "203.0.113.9" });
    expect(calls.map((c) => c.url.split("/v1")[1])).toEqual(["/ssh_keys", "/firewalls", "/servers"]);
    expect(calls.every((c) => c.auth === "Bearer tok")).toBe(true);
    expect(calls[0]!.body.public_key).toBe("ssh-ed25519 AAAA yeah");
    expect(calls[1]!.body.rules.map((r: { port: string }) => r.port)).toEqual(["22", "80", "443"]);
    expect(calls[2]!.body).toMatchObject({ ssh_keys: [11], firewalls: [{ firewall: 22 }], server_type: "cx22" });
  });
  test("surfaces the provider's error message", async () => {
    const fetchImpl = async () => Response.json({ error: { message: "invalid token" } }, { status: 401 });
    await expect(createHetznerServer(input, fetchImpl)).rejects.toThrow(HetznerError);
    await expect(createHetznerServer(input, fetchImpl)).rejects.toThrow("invalid token");
  });
});
