/** Minimal Hetzner Cloud client (https://docs.hetzner.cloud) — just what "create a VPS from the panel" needs. `fetch` is injectable for tests. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const BASE = "https://api.hetzner.cloud/v1";

export class HetznerError extends Error {}

export interface CreateHetznerServerInput {
  apiToken: string;
  name: string;
  serverType: string;
  location: string;
  image: string;
  /** OpenSSH public key line to authorize on the new machine. */
  sshPublicKey: string;
}

export interface CreatedHetznerServer {
  hetznerServerId: number;
  ipv4: string;
}

async function call<T>(fetchImpl: FetchLike, token: string, method: "POST", path: string, body: unknown): Promise<T> {
  const res = await fetchImpl(`${BASE}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: string } } & T;
  if (!res.ok) throw new HetznerError(`Hetzner: ${json.error?.message ?? res.statusText} (${res.status})`);
  return json;
}

/** Ports the panel needs reachable: SSH for the worker, HTTP/HTTPS for the proxy. */
export const FIREWALL_RULES = [22, 80, 443].map((port) => ({
  direction: "in",
  protocol: "tcp",
  port: String(port),
  source_ips: ["0.0.0.0/0", "::/0"],
}));

/** Registers the key, creates a firewall (22/80/443 only) and the server with both attached. */
export async function createHetznerServer(input: CreateHetznerServerInput, fetchImpl: FetchLike = fetch): Promise<CreatedHetznerServer> {
  const suffix = Math.random().toString(36).slice(2, 8);
  const key = await call<{ ssh_key: { id: number } }>(fetchImpl, input.apiToken, "POST", "/ssh_keys", {
    name: `yeah-${input.name}-${suffix}`,
    public_key: input.sshPublicKey.trim(),
  });
  const firewall = await call<{ firewall: { id: number } }>(fetchImpl, input.apiToken, "POST", "/firewalls", {
    name: `yeah-${input.name}-${suffix}`,
    rules: FIREWALL_RULES,
  });
  const created = await call<{ server: { id: number; public_net: { ipv4: { ip: string } } } }>(fetchImpl, input.apiToken, "POST", "/servers", {
    name: input.name,
    server_type: input.serverType,
    location: input.location,
    image: input.image,
    ssh_keys: [key.ssh_key.id],
    firewalls: [{ firewall: firewall.firewall.id }],
    start_after_create: true,
  });
  return { hetznerServerId: created.server.id, ipv4: created.server.public_net.ipv4.ip };
}
