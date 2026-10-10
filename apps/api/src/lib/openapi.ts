const teamIdParam = { name: "teamId", in: "path", required: true, schema: { type: "string" } };
const idParam = (name: string) => ({ name, in: "path", required: true, schema: { type: "string" } });
const listOp = (summary: string) => ({
  summary,
  security: [{ bearerAuth: [] }],
  parameters: [teamIdParam],
  responses: { "200": { description: "OK" }, "401": { description: "Token ausente, inválido, expirado ou de outro time" } },
});
const triggerOp = (summary: string, extra: object[] = []) => ({
  summary,
  description: "Exige token com permissão `full`.",
  security: [{ bearerAuth: [] }],
  parameters: [teamIdParam, ...extra],
  responses: {
    "200": { description: "Enfileirado" },
    "401": { description: "Não autenticado" },
    "403": { description: "Token somente leitura" },
    "404": { description: "Recurso não encontrado" },
    "429": { description: "Rate limit — veja o header Retry-After" },
  },
});

/** Hand-written OpenAPI 3 description of the token-authenticated API (the session-cookie routes used by the web app are intentionally not part of it). */
export function buildOpenApiSpec() {
  const base = "/api/v1/teams/{teamId}";
  return {
    openapi: "3.0.3",
    info: { title: "yeah API", version: "1.0.0", description: "API pública autenticada por token pessoal (Keys & Tokens). Mutações: 120/min por IP; ao estourar, 429 + Retry-After." },
    components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", description: "Token `yeah_…`" } } },
    paths: {
      [`${base}/applications`]: { get: listOp("Lista aplicações do time") },
      [`${base}/databases`]: { get: listOp("Lista bancos do time") },
      [`${base}/services`]: { get: listOp("Lista serviços do time") },
      [`${base}/applications/{applicationId}/deploy`]: {
        post: triggerOp("Enfileira um deploy", [idParam("applicationId"), { name: "force", in: "query", required: false, schema: { type: "string", enum: ["true"] } }]),
      },
      [`${base}/move-resource`]: {
        post: triggerOp("Move uma aplicação, banco ou serviço para outro ambiente do mesmo time. Corpo: { kind: application|database|service, resourceId, targetEnvironmentId }."),
      },
      [`${base}/databases/{databaseId}/backup`]: { post: triggerOp("Dispara backup manual (precisa de agendamento existente)", [idParam("databaseId")]) },
    },
  };
}

export const SWAGGER_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>yeah API</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14/swagger-ui.css"></head>
<body><div id="ui"></div>
<script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14/swagger-ui-bundle.js"></script>
<script>SwaggerUIBundle({ url: "/api/v1/openapi.json", dom_id: "#ui" });</script></body></html>`;
