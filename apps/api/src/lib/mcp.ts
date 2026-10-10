import type { ActionResult } from "./ciActions";

/** What the MCP endpoint can do — injected so the protocol layer is unit-testable without a database. */
export interface McpOps {
  listApplications(): Promise<unknown[]>;
  listDatabases(): Promise<unknown[]>;
  listServices(): Promise<unknown[]>;
  listDeployments(applicationId: string): Promise<ActionResult<unknown[]>>;
  deploy(applicationId: string, force: boolean): Promise<ActionResult<unknown>>;
  backup(databaseId: string): Promise<ActionResult<unknown>>;
}

interface RpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

const PROTOCOL_VERSION = "2025-03-26";

const TOOLS = [
  { name: "list_applications", description: "Lista as aplicações do time.", write: false, props: {}, required: [] as string[] },
  { name: "list_databases", description: "Lista os bancos do time.", write: false, props: {}, required: [] as string[] },
  { name: "list_services", description: "Lista os serviços do time.", write: false, props: {}, required: [] as string[] },
  {
    name: "list_deployments",
    description: "Últimos 10 deploys de uma aplicação (status e datas, sem o log de build).",
    write: false,
    props: { applicationId: { type: "string" } },
    required: ["applicationId"],
  },
  {
    name: "deploy_application",
    description: "Enfileira um deploy. Só disponível com token de escrita.",
    write: true,
    props: { applicationId: { type: "string" }, force: { type: "boolean" } },
    required: ["applicationId"],
  },
  {
    name: "backup_database",
    description: "Dispara um backup manual. Só disponível com token de escrita.",
    write: true,
    props: { databaseId: { type: "string" } },
    required: ["databaseId"],
  },
];

const RESOURCES = [
  { uri: "yeah://applications", name: "Aplicações", mimeType: "application/json" },
  { uri: "yeah://databases", name: "Bancos", mimeType: "application/json" },
  { uri: "yeah://services", name: "Serviços", mimeType: "application/json" },
];

const PROMPTS = [
  {
    name: "debug_deploy",
    description: "Ajuda a investigar um deploy que falhou.",
    arguments: [{ name: "applicationId", description: "Id da aplicação", required: true }],
  },
];

const ok = (id: RpcRequest["id"], result: unknown) => ({ jsonrpc: "2.0", id: id ?? null, result });
const rpcError = (id: RpcRequest["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
const text = (value: unknown, isError = false) => ({
  content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
  isError,
});

/** Returns the JSON-RPC response, or null for notifications (no reply). `readOnly` hides and rejects write tools. */
export async function handleMcp(req: RpcRequest, ops: McpOps, readOnly: boolean): Promise<object | null> {
  const { id, method, params = {} } = req;
  if (req.jsonrpc !== "2.0" || !method) return rpcError(id, -32600, "invalid request");
  if (method.startsWith("notifications/")) return null;

  switch (method) {
    case "initialize":
      return ok(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {}, resources: {}, prompts: {} },
        serverInfo: { name: "yeah", version: "1.0.0" },
      });
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, {
        tools: TOOLS.filter((t) => !readOnly || !t.write).map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: { type: "object", properties: t.props, required: t.required },
        })),
      });
    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === params.name);
      if (!tool) return rpcError(id, -32602, `ferramenta desconhecida: ${String(params.name)}`);
      if (tool.write && readOnly) return ok(id, text("este token é só leitura", true));
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      const str = (k: string) => (typeof args[k] === "string" ? (args[k] as string) : "");
      for (const key of tool.required) if (!str(key)) return ok(id, text(`argumento obrigatório: ${key}`, true));
      const fromResult = (r: ActionResult<unknown>) => (r.ok ? text(r.value) : text(r.error, true));
      switch (tool.name) {
        case "list_applications":
          return ok(id, text(await ops.listApplications()));
        case "list_databases":
          return ok(id, text(await ops.listDatabases()));
        case "list_services":
          return ok(id, text(await ops.listServices()));
        case "list_deployments":
          return ok(id, fromResult(await ops.listDeployments(str("applicationId"))));
        case "deploy_application":
          return ok(id, fromResult(await ops.deploy(str("applicationId"), args.force === true)));
        default:
          return ok(id, fromResult(await ops.backup(str("databaseId"))));
      }
    }
    case "resources/list":
      return ok(id, { resources: RESOURCES });
    case "resources/read": {
      const uri = String(params.uri);
      const loaders: Record<string, () => Promise<unknown[]>> = {
        "yeah://applications": ops.listApplications,
        "yeah://databases": ops.listDatabases,
        "yeah://services": ops.listServices,
      };
      const load = loaders[uri];
      if (!load) return rpcError(id, -32602, `recurso desconhecido: ${uri}`);
      return ok(id, { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(await load(), null, 2) }] });
    }
    case "prompts/list":
      return ok(id, { prompts: PROMPTS });
    case "prompts/get": {
      if (params.name !== "debug_deploy") return rpcError(id, -32602, `prompt desconhecido: ${String(params.name)}`);
      const applicationId = String((params.arguments as Record<string, unknown> | undefined)?.applicationId ?? "");
      return ok(id, {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Investigue os deploys recentes da aplicação ${applicationId}: use list_deployments para ver o histórico, compare o status dos últimos deploys, e use list_applications para checar o estado atual. Resuma o que falhou e sugira próximos passos. Você não tem acesso aos logs de build por aqui — peça ao usuário para colar o trecho relevante se precisar.`,
            },
          },
        ],
      });
    }
    default:
      return rpcError(id, -32601, `método desconhecido: ${method}`);
  }
}
