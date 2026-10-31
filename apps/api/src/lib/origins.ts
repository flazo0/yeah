import { getPanelDomain } from "@yeah/db";
import { withPanelOrigin } from "@yeah/shared";
import { db } from "./db";

// The browser origins the panel accepts (CORS, passkeys, terminal WebSockets): WEB_ORIGIN from the environment
// plus the panel's own domain once one is configured in the settings. The domain lives in the database, but CORS
// and the other checks are synchronous, so it is kept in memory and refreshed in the background.

const DEV_DEFAULT = "http://localhost:5173,http://localhost:5174";
let panelDomain: string | null = null;

export async function refreshPanelDomain(): Promise<void> {
  try {
    panelDomain = await getPanelDomain(db);
  } catch {
    // keep the last known value: a database blip must not lock everybody out
  }
}

export function currentPanelDomain(): string | null {
  return panelDomain;
}

export function allowedOrigins(): string[] {
  return withPanelOrigin(process.env.WEB_ORIGIN ?? DEV_DEFAULT, panelDomain)
    .split(",")
    .map((o) => o.trim());
}

/** Loads the domain now and again every 30 seconds (a change made through another API process shows up within that). */
export function startOriginRefresh(): void {
  void refreshPanelDomain();
  const timer = setInterval(refreshPanelDomain, 30_000);
  (timer as { unref?: () => void }).unref?.();
}
