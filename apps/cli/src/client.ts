/** Thin client over the token-authenticated CI API (`/teams/:teamId/ci`). No dependencies, `fetch` injectable for tests. */
export interface CliConfig {
  url: string;
  token: string;
  team: string;
}

export class CliError extends Error {}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function configFromEnv(env: Record<string, string | undefined>): CliConfig {
  const url = env.YEAH_URL?.replace(/\/+$/, "");
  const token = env.YEAH_TOKEN;
  const team = env.YEAH_TEAM;
  const missing = [!url && "YEAH_URL", !token && "YEAH_TOKEN", !team && "YEAH_TEAM"].filter(Boolean);
  if (missing.length > 0) throw new CliError(`variáveis de ambiente faltando: ${missing.join(", ")}`);
  return { url: url!, token: token!, team: team! };
}

export async function request(config: CliConfig, fetchImpl: FetchLike, method: "GET" | "POST", path: string): Promise<unknown> {
  const res = await fetchImpl(`${config.url}/teams/${config.team}/ci${path}`, {
    method,
    headers: { authorization: `Bearer ${config.token}` },
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (res.status === 429) throw new CliError(`limite de requisições atingido — tente de novo em ${res.headers.get("retry-after") ?? "alguns"}s`);
  if (!res.ok) throw new CliError(body.error ?? `erro HTTP ${res.status}`);
  return body;
}
