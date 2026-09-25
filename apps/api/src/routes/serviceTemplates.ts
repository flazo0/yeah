import { Elysia } from "elysia";
import { getUserFromSessionId, SESSION_COOKIE } from "../lib/session";
import { assertMember } from "../lib/access";
import { loadTemplates, toTemplateDto } from "../lib/templates";

// The catalog of one-click services, read from packages/templates/services.
export const serviceTemplateRoutes = new Elysia({ prefix: "/teams/:teamId/service-templates" }).get("/", async ({ cookie, params, set }) => {
  const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
  if (!user) {
    set.status = 401;
    return { error: "unauthorized" };
  }
  if (!(await assertMember(params.teamId, user.id))) {
    set.status = 403;
    return { error: "forbidden" };
  }
  return { templates: loadTemplates().map(toTemplateDto) };
});
