import { describe, expect, test } from "bun:test";
import { createDigitalOceanDroplet, createVultrInstance, VpsProviderError } from "./vpsProviders";

const input = { apiToken: "tok", name: "app1", size: "s", region: "r", image: "img", sshPublicKey: "ssh-ed25519 AAAA yeah\n" };
const noSleep = { sleep: async () => {}, delayMs: 0 };

function recorder(handler: (method: string, url: string, body: any) => Response) {
  const calls: Array<{ method: string; url: string; body: any }> = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ method: init?.method ?? "GET", url, body });
    return handler(init?.method ?? "GET", url, body);
  };
  return { calls, fetchImpl };
}

describe("createDigitalOceanDroplet", () => {
  test("key, tag-scoped firewall, droplet, then polls until the public IP appears", async () => {
    let polls = 0;
    const { calls, fetchImpl } = recorder((method, url) => {
      if (url.endsWith("/account/keys")) return Response.json({ ssh_key: { id: 1 } });
      if (url.endsWith("/firewalls")) return Response.json({ firewall: { id: "f" } });
      if (url.endsWith("/droplets")) return Response.json({ droplet: { id: 9 } });
      polls++;
      return Response.json({ droplet: { networks: { v4: polls < 3 ? [] : [{ type: "private", ip_address: "10.0.0.2" }, { type: "public", ip_address: "203.0.113.7" }] } } });
    });
    const result = await createDigitalOceanDroplet(input, fetchImpl, noSleep);
    expect(result.ipv4).toBe("203.0.113.7");
    expect(polls).toBe(3);
    const firewall = calls.find((c) => c.url.endsWith("/firewalls"))!.body;
    const droplet = calls.find((c) => c.url.endsWith("/droplets"))!.body;
    expect(droplet.tags).toEqual(firewall.tags);
    expect(firewall.inbound_rules.map((r: { ports: string }) => r.ports)).toEqual(["22", "80", "443"]);
    expect(droplet).toMatchObject({ ssh_keys: [1], size: "s", region: "r", image: "img" });
  });
  test("gives up with a clear message when no IP ever shows up", async () => {
    const { fetchImpl } = recorder((_m, url) => {
      if (url.endsWith("/account/keys")) return Response.json({ ssh_key: { id: 1 } });
      if (url.endsWith("/firewalls")) return Response.json({});
      if (url.endsWith("/droplets")) return Response.json({ droplet: { id: 9 } });
      return Response.json({ droplet: { networks: { v4: [] } } });
    });
    await expect(createDigitalOceanDroplet(input, fetchImpl, { ...noSleep, attempts: 2 })).rejects.toThrow("sem IP público");
  });
  test("surfaces provider errors", async () => {
    const { fetchImpl } = recorder(() => Response.json({ message: "Unable to authenticate you" }, { status: 401 }));
    await expect(createDigitalOceanDroplet(input, fetchImpl, noSleep)).rejects.toThrow(VpsProviderError);
  });
});

describe("createVultrInstance", () => {
  test("key, firewall rules for 22/80/443 (v4+v6), instance, waits for a real IP", async () => {
    let polls = 0;
    const { calls, fetchImpl } = recorder((method, url) => {
      if (url.endsWith("/ssh-keys")) return Response.json({ ssh_key: { id: "k1" } });
      if (url.endsWith("/firewalls")) return Response.json({ firewall_group: { id: "g1" } });
      if (url.endsWith("/rules")) return Response.json({ firewall_rule: {} });
      if (method === "POST" && url.endsWith("/instances")) return Response.json({ instance: { id: "i1" } });
      polls++;
      return Response.json({ instance: { main_ip: polls < 2 ? "0.0.0.0" : "198.51.100.4" } });
    });
    const result = await createVultrInstance({ ...input, image: "1743" }, fetchImpl, noSleep);
    expect(result.ipv4).toBe("198.51.100.4");
    expect(calls.filter((c) => c.url.endsWith("/rules"))).toHaveLength(6);
    expect(calls.find((c) => c.method === "POST" && c.url.endsWith("/instances"))!.body).toMatchObject({ os_id: 1743, sshkey_id: ["k1"], firewall_group_id: "g1", plan: "s", region: "r" });
  });
});
