import { CliError, configFromEnv, request, type FetchLike } from "./client";

export const USAGE = `yeah — CLI do painel (usa a API de CI com token pessoal)

Uso:
  yeah list apps|databases|services
  yeah deploy <applicationId> [--force]
  yeah backup <databaseId>

Variáveis de ambiente: YEAH_URL (URL da API), YEAH_TOKEN (token de API), YEAH_TEAM (id do time)`;

const LIST_KINDS: Record<string, string> = { apps: "applications", databases: "databases", services: "services" };

/** Returns the text to print; throws CliError for anything the user should see as a failure. */
export async function run(argv: string[], env: Record<string, string | undefined>, fetchImpl: FetchLike): Promise<string> {
  const [command, arg, ...flags] = argv;
  if (!command || command === "help" || command === "--help") return USAGE;

  if (command === "list") {
    const kind = arg ? LIST_KINDS[arg] : undefined;
    if (!kind) throw new CliError("uso: yeah list apps|databases|services");
    const body = (await request(configFromEnv(env), fetchImpl, "GET", `/${kind}`)) as Record<string, Array<Record<string, unknown>>>;
    const rows = body[kind] ?? [];
    return rows.length === 0 ? "(nenhum)" : rows.map((r) => `${r.id}\t${r.name}\t${r.status}`).join("\n");
  }
  if (command === "deploy") {
    if (!arg) throw new CliError("uso: yeah deploy <applicationId> [--force]");
    const force = flags.includes("--force") ? "?force=true" : "";
    const body = (await request(configFromEnv(env), fetchImpl, "POST", `/applications/${encodeURIComponent(arg)}/deploy${force}`)) as { deploymentId: string };
    return `deploy enfileirado: ${body.deploymentId}`;
  }
  if (command === "backup") {
    if (!arg) throw new CliError("uso: yeah backup <databaseId>");
    await request(configFromEnv(env), fetchImpl, "POST", `/databases/${encodeURIComponent(arg)}/backup`);
    return "backup enfileirado";
  }
  throw new CliError(`comando desconhecido: ${command}\n\n${USAGE}`);
}
