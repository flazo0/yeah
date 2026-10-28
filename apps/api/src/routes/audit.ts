import { Elysia, t } from "elysia";
import { getUserFromSessionId, SESSION_COOKIE } from "../lib/session";
import { assertMember } from "../lib/access";
import { listAuditEvents } from "../lib/audit";

export const auditRoutes = new Elysia({ prefix: "/teams/:teamId/audit" }).get(
  "/",
  async ({ cookie, params, query, set }) => {
    const user = await getUserFromSessionId(cookie[SESSION_COOKIE]?.value);
    if (!user) {
      set.status = 401;
      return { error: "unauthorized" };
    }
    if (!(await assertMember(params.teamId, user.id))) {
      set.status = 403;
      return { error: "forbidden" };
    }
    const before = query.before ? new Date(query.before) : undefined;
    if (before && Number.isNaN(before.getTime())) {
      set.status = 400;
      return { error: "data inválida" };
    }
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
    const events = await listAuditEvents({
      teamId: params.teamId,
      limit,
      before,
      level: query.level === "warning" || query.level === "info" ? query.level : undefined,
    });
    return { events, nextBefore: events.length === limit ? events[events.length - 1]!.createdAt : null };
  },
  { query: t.Object({ before: t.Optional(t.String()), limit: t.Optional(t.String()), level: t.Optional(t.String()) }) },
);
