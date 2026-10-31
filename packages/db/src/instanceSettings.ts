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

export interface InstanceBackupSettings {
  enabled: boolean;
  storageId: string | null;
  hourUtc: number;
  retention: number;
  lastAt: Date | null;
  lastStatus: string | null;
  lastError: string | null;
  lastSizeBytes: number | null;
}

export async function getInstanceBackupSettings(db: Db): Promise<InstanceBackupSettings> {
  const [row] = await db.select().from(instanceSettings).limit(1);
  return {
    enabled: row?.backupEnabled ?? false,
    storageId: row?.backupStorageId ?? null,
    hourUtc: row?.backupHourUtc ?? 3,
    retention: row?.backupRetention ?? 7,
    lastAt: row?.backupLastAt ?? null,
    lastStatus: row?.backupLastStatus ?? null,
    lastError: row?.backupLastError ?? null,
    lastSizeBytes: row?.backupLastSizeBytes ?? null,
  };
}

type BackupColumns = Partial<{
  backupEnabled: boolean;
  backupStorageId: string | null;
  backupHourUtc: number;
  backupRetention: number;
  backupLastAt: Date | null;
  backupLastStatus: string | null;
  backupLastError: string | null;
  backupLastSizeBytes: number | null;
}>;

/** Updates the backup columns of the single settings row, creating it on first use. */
export async function updateInstanceBackupColumns(db: Db, patch: BackupColumns): Promise<void> {
  const [row] = await db.select({ id: instanceSettings.id }).from(instanceSettings).limit(1);
  if (row) await db.update(instanceSettings).set({ ...patch, updatedAt: new Date() }).where(eq(instanceSettings.id, row.id));
  else await db.insert(instanceSettings).values(patch);
}
