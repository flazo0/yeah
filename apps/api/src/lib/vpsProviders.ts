import { createHetznerServer, type FetchLike } from "./hetzner";

export type VpsProvider = "hetzner" | "digitalocean" | "vultr";

export interface CreateVpsInput {
  apiToken: string;
  name: string;
  /** Provider-specific size/plan slug (cx22, s-1vcpu-1gb, vc2-1c-1gb). */
  size: string;
  /** Provider-specific region/location (nbg1, nyc3, ewr). */
  region: string;
  /** Provider-specific image (ubuntu-24.04, ubuntu-24-04-x64, or Vultr's numeric os_id). */
  image: string;
  sshPublicKey: string;
}

export class VpsProviderError extends Error {}

export interface PollOptions {
  attempts?: number;
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function json<T>(fetchImpl: FetchLike, token: string, method: "GET" | "POST", url: string, body?: unknown): Promise<T> {
  const res = await fetchImpl(url, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const message = typeof data.message === "string" ? data.message : typeof data.error === "string" ? data.error : res.statusText;
    throw new VpsProviderError(`${new URL(url).hostname}: ${message} (${res.status})`);
  }
  return data as T;
}

/** Ports the panel needs reachable: SSH for the worker, HTTP/HTTPS for the proxy. */
const PORTS = ["22", "80", "443"];

export async function createDigitalOceanDroplet(input: CreateVpsInput, fetchImpl: FetchLike = fetch, poll: PollOptions = {}): Promise<{ ipv4: string }> {
  const { attempts = 30, delayMs = 4000, sleep = defaultSleep } = poll;
  const base = "https://api.digitalocean.com/v2";
  const suffix = Math.random().toString(36).slice(2, 8);
  const tag = `yeah-${suffix}`;
  const key = await json<{ ssh_key: { id: number } }>(fetchImpl, input.apiToken, "POST", `${base}/account/keys`, {
    name: `yeah-${input.name}-${suffix}`,
    public_key: input.sshPublicKey.trim(),
  });
  // Firewalls attach by tag, so the droplet created below is covered from its first boot.
  await json(fetchImpl, input.apiToken, "POST", `${base}/firewalls`, {
    name: `yeah-${input.name}-${suffix}`,
    tags: [tag],
    inbound_rules: PORTS.map((ports) => ({ protocol: "tcp", ports, sources: { addresses: ["0.0.0.0/0", "::/0"] } })),
    outbound_rules: [
      { protocol: "tcp", ports: "all", destinations: { addresses: ["0.0.0.0/0", "::/0"] } },
      { protocol: "udp", ports: "all", destinations: { addresses: ["0.0.0.0/0", "::/0"] } },
      { protocol: "icmp", destinations: { addresses: ["0.0.0.0/0", "::/0"] } },
    ],
  });
  const created = await json<{ droplet: { id: number } }>(fetchImpl, input.apiToken, "POST", `${base}/droplets`, {
    name: input.name,
    region: input.region,
    size: input.size,
    image: input.image,
    ssh_keys: [key.ssh_key.id],
    tags: [tag],
  });
  for (let i = 0; i < attempts; i++) {
    const res = await json<{ droplet: { networks?: { v4?: Array<{ type: string; ip_address: string }> } } }>(fetchImpl, input.apiToken, "GET", `${base}/droplets/${created.droplet.id}`);
    const ip = res.droplet.networks?.v4?.find((n) => n.type === "public")?.ip_address;
    if (ip) return { ipv4: ip };
    await sleep(delayMs);
  }
  throw new VpsProviderError(`droplet ${created.droplet.id} criado, mas ainda sem IP público — veja no painel da DigitalOcean e cadastre manualmente`);
}

export async function createVultrInstance(input: CreateVpsInput, fetchImpl: FetchLike = fetch, poll: PollOptions = {}): Promise<{ ipv4: string }> {
  const { attempts = 30, delayMs = 4000, sleep = defaultSleep } = poll;
  const base = "https://api.vultr.com/v2";
  const suffix = Math.random().toString(36).slice(2, 8);
  const key = await json<{ ssh_key: { id: string } }>(fetchImpl, input.apiToken, "POST", `${base}/ssh-keys`, {
    name: `yeah-${input.name}-${suffix}`,
    ssh_key: input.sshPublicKey.trim(),
  });
  const group = await json<{ firewall_group: { id: string } }>(fetchImpl, input.apiToken, "POST", `${base}/firewalls`, { description: `yeah-${input.name}-${suffix}` });
  for (const port of PORTS) {
    for (const [ip_type, subnet, subnet_size] of [["v4", "0.0.0.0", 0], ["v6", "::", 0]] as const) {
      await json(fetchImpl, input.apiToken, "POST", `${base}/firewalls/${group.firewall_group.id}/rules`, { ip_type, protocol: "tcp", subnet, subnet_size, port });
    }
  }
  const osId = Number(input.image);
  const created = await json<{ instance: { id: string } }>(fetchImpl, input.apiToken, "POST", `${base}/instances`, {
    label: input.name,
    hostname: input.name,
    region: input.region,
    plan: input.size,
    ...(Number.isInteger(osId) ? { os_id: osId } : { image_id: input.image }),
    sshkey_id: [key.ssh_key.id],
    firewall_group_id: group.firewall_group.id,
  });
  for (let i = 0; i < attempts; i++) {
    const res = await json<{ instance: { main_ip?: string } }>(fetchImpl, input.apiToken, "GET", `${base}/instances/${created.instance.id}`);
    const ip = res.instance.main_ip;
    // Vultr reports 0.0.0.0 until the address is assigned.
    if (ip && ip !== "0.0.0.0") return { ipv4: ip };
    await sleep(delayMs);
  }
  throw new VpsProviderError(`instância ${created.instance.id} criada, mas ainda sem IP — veja no painel da Vultr e cadastre manualmente`);
}

export async function createVps(provider: VpsProvider, input: CreateVpsInput, fetchImpl: FetchLike = fetch, poll: PollOptions = {}): Promise<{ ipv4: string }> {
  switch (provider) {
    case "hetzner": {
      const created = await createHetznerServer({ apiToken: input.apiToken, name: input.name, serverType: input.size, location: input.region, image: input.image, sshPublicKey: input.sshPublicKey }, fetchImpl);
      return { ipv4: created.ipv4 };
    }
    case "digitalocean":
      return createDigitalOceanDroplet(input, fetchImpl, poll);
    case "vultr":
      return createVultrInstance(input, fetchImpl, poll);
  }
}
