import { applications, type Application } from "@yeah/db";

/**
 * Column values for a copy of `app`: everything but identity, hostnames (two apps cannot answer on the
 * same domain), the deploy webhook token, the deploy baseline and the status. The deploy key is the same
 * repository's key, so the copy shares it. `overrides` are applied last.
 */
export function applicationCopyValues(app: Application, overrides: Partial<typeof applications.$inferInsert>): typeof applications.$inferInsert {
  const { id: _id, createdAt: _c, domain: _d, extraDomains: _e, wwwRedirect: _w, deployTokenHash: _t, deployedConfig: _dc, status: _s, previewEnabled: _pe, previewOfId: _po, prNumber: _pn, ...rest } = app;
  void [_id, _c, _d, _e, _w, _t, _dc, _s, _pe, _po, _pn];
  return {
    ...rest,
    status: "idle",
    domain: null,
    extraDomains: [],
    wwwRedirect: "none",
    deployTokenHash: null,
    deployedConfig: null,
    previewEnabled: false,
    previewOfId: null,
    prNumber: null,
    ...overrides,
  };
}
