import { eq } from "drizzle-orm";
import type { Db } from "./client";
import { instanceSettings } from "./schema";

/** The panel's own domain, or null when none is set. Small and read often (origin checks), so callers cache it. */
export async function getPanelDomain(db: Db): Promise<string | null> {
  const [row] = await db.select({ panelDomain: instanceSettings.panelDomain }).from(instanceSettings).limit(1);
  return row?.panelDomain ?? null;
}

/** Sets (or clears, with null) the panel's domain, creating the single settings row on first use. */
export async function setPanelDomain(db: Db, domain: string | null): Promise<void> {
  const [row] = await db.select({ id: instanceSettings.id }).from(instanceSettings).limit(1);
  if (row) await db.update(instanceSettings).set({ panelDomain: domain, updatedAt: new Date() }).where(eq(instanceSettings.id, row.id));
  else await db.insert(instanceSettings).values({ panelDomain: domain });
}
