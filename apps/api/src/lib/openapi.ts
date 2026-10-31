const teamIdParam = { name: "teamId", in: "path", required: true, schema: { type: "string" } };
const idParam = (name: string) => ({ name, in: "path", required: true, schema: { type: "string" } });
const listOp = (summary: string) => ({
  summary,
  security: [{ bearerAuth: [] }],
  parameters: [teamIdParam],
  responses: { "200": { description: "OK" }, "401": { description: "Missing, invalid or expired token, or a token from another team" } },
});
const triggerOp = (summary: string, extra: object[] = []) => ({
  summary,
  description: "Requires a token with `full` permission.",
  security: [{ bearerAuth: [] }],
  parameters: [teamIdParam, ...extra],
  responses: {
    "200": { description: "Enfileirado" },
    "401": { description: "Not authenticated" },
    "403": { description: "Read-only token" },
    "404": { description: "Resource not found" },
    "429": { description: "Rate limit — veja o header Retry-After" },
  },
});

/** Hand-written OpenAPI 3 description of the token-authenticated API (the session-cookie routes used by the web app are intentionally not part of it). */
export function buildOpenApiSpec() {
  const base = "/api/v1/teams/{teamId}";
  return {
    openapi: "3.0.3",
    info: { title: "yeah API", version: "1.0.0", description: "Public API authenticated with a personal token (Keys & Tokens). Mutations: 120/min per IP; beyond that, 429 + Retry-After." },
    components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", description: "Token `yeah_…`" } } },
    paths: {
      [`${base}/applications`]: { get: listOp("Lists the team's applications") },
      [`${base}/databases`]: { get: listOp("Lists the team's databases") },
      [`${base}/services`]: { get: listOp("Lists the team's services") },
      [`${base}/servers`]: { get: listOp("Lists the team's servers (without credentials)") },
      [`${base}/projects`]: { get: listOp("Lists projects with their environments") },
      [`${base}/storages`]: { get: listOp("Lists S3 destinations (without keys)") },
      [`${base}/notification-channels`]: { get: listOp("Lists notification channels (without secrets)") },
      [`${base}/scheduled-tasks`]: { get: listOp("Lists the team's scheduled application tasks") },
      [`${base}/applications/{applicationId}/deployments`]: {
        get: { ...listOp("Last 10 deployments of an application (without the log)"), parameters: [teamIdParam, idParam("applicationId")] },
      },
      [`${base}/applications/{applicationId}/previews`]: {
        get: { ...listOp("Previews of an application (one per open pull request)"), parameters: [teamIdParam, idParam("applicationId")] },
      },
      [`${base}/applications/{applicationId}/previews/{previewId}`]: {
        get: { ...listOp("A preview with its latest deployments (without logs)"), parameters: [teamIdParam, idParam("applicationId"), idParam("previewId")] },
      },
      [`${base}/applications/{applicationId}/deploy`]: {
        post: triggerOp("Enfileira um deploy", [idParam("applicationId"), { name: "force", in: "query", required: false, schema: { type: "string", enum: ["true"] } }]),
      },
      [`${base}/move-resource`]: {
        post: triggerOp("Moves an application, database or service to another environment of the same team. Body: { kind: application|database|service, resourceId, targetEnvironmentId }."),
      },
      [`${base}/databases/{databaseId}/backup`]: { post: triggerOp("Triggers a manual backup (requires an existing schedule)", [idParam("databaseId")]) },
    },
  };
}

export const SWAGGER_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>yeah API</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14/swagger-ui.css"></head>
<body><div id="ui"></div>
<script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14/swagger-ui-bundle.js"></script>
<script>SwaggerUIBundle({ url: "/api/v1/openapi.json", dom_id: "#ui" });</script></body></html>`;
