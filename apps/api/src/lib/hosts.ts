import { eq } from "drizzle-orm";
import { applications, services } from "@yeah/db";
import { computeRouting, normalizeHost } from "@yeah/shared";
import { db } from "./db";

/**
 * Hostnames a team's resources already answer on (applications with their extra domains and www redirect,
 * services' domains), keyed by hostname. `exceptServiceId` skips one service so it can keep its own.
 */
export async function claimedHosts(teamId: string, exceptServiceId?: string): Promise<Map<string, string>> {
  const claimed = new Map<string, string>();
  for (const a of await db.select().from(applications).where(eq(applications.teamId, teamId))) {
    if (!a.domain) continue;
    const r = computeRouting(normalizeHost(a.domain), a.extraDomains, a.wwwRedirect);
    for (const h of [...r.hosts, ...(r.redirectFrom ? [r.redirectFrom] : [])]) claimed.set(h, a.name);
  }
  for (const s of await db.select().from(services).where(eq(services.teamId, teamId))) {
    if (s.id === exceptServiceId) continue;
    if (s.domain) claimed.set(normalizeHost(s.domain), s.name);
    for (const d of s.domains) claimed.set(normalizeHost(d.domain), s.name);
  }
  return claimed;
}
