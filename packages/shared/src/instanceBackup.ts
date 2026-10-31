import { shellQuote } from "./shell";

// Scheduled backup of the panel's own PostgreSQL database to S3. Pure helpers: when it is due, how files are named,
// which old ones to remove and the command that makes the dump on the panel's host.

export const INSTANCE_BACKUP_PREFIX = "yeah-instance/";
export const INSTANCE_BACKUP_DEFAULTS = { hourUtc: 3, retention: 7 } as const;
export const INSTANCE_BACKUP_MAX_RETENTION = 90;
/** Where the dump is staged on the host until it has been uploaded. */
export const INSTANCE_BACKUP_STAGING_DIR = "/opt/yeah-backups/instance";
const KEY_PATTERN = /^yeah-instance\/yeah-\d{8}-\d{6}\.sql\.gz$/;
/** A scheduled run is skipped when one already finished this recently (the tick runs several times inside the chosen hour). */
const MIN_GAP_MS = 20 * 60 * 60 * 1000;

export interface InstanceBackupSchedule {
  enabled: boolean;
  storageId: string | null;
  hourUtc: number;
  lastAt: Date | null;
}

/** Whether a tick at `now` should start a backup. `force` is "Back up now". */
export function isInstanceBackupDue(now: Date, s: InstanceBackupSchedule, force = false): boolean {
  if (!s.storageId) return false;
  if (force) return true;
  if (!s.enabled) return false;
  if (now.getUTCHours() !== s.hourUtc) return false;
  return s.lastAt === null || now.getTime() - s.lastAt.getTime() >= MIN_GAP_MS;
}

export function validateInstanceBackupSettings(hourUtc: number, retention: number): string | null {
  if (!Number.isInteger(hourUtc) || hourUtc < 0 || hourUtc > 23) return "the hour must be a whole number from 0 to 23";
  if (!Number.isInteger(retention) || retention < 1 || retention > INSTANCE_BACKUP_MAX_RETENTION) return `keep between 1 and ${INSTANCE_BACKUP_MAX_RETENTION} backups`;
  return null;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function instanceBackupKey(at: Date): string {
  const d = `${at.getUTCFullYear()}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}`;
  const t = `${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}${pad(at.getUTCSeconds())}`;
  return `${INSTANCE_BACKUP_PREFIX}yeah-${d}-${t}.sql.gz`;
}

/** Keys to delete so that only the newest `keep` remain. Only files that look like ours are ever touched. */
export function instanceBackupsToDelete(keys: string[], keep: number): string[] {
  const ours = keys.filter((k) => KEY_PATTERN.test(k)).sort().reverse();
  return ours.slice(Math.max(0, keep));
}

/**
 * Dumps the panel's database to `outPath` on the panel's host, compressed. It runs pg_dump inside the postgres
 * container (credentials come from the container's own environment, so nothing is read from .env), fails if the
 * dump is empty or the archive is damaged, and only then moves it into place.
 */
export function buildInstanceDumpCommand(installDir: string, outPath: string): string {
  const tmp = `${outPath}.partial`;
  const dir = outPath.slice(0, outPath.lastIndexOf("/"));
  const inner =
    `set -o pipefail; mkdir -p ${shellQuote(dir)} && cd ${shellQuote(installDir)} && ` +
    `docker compose -f docker-compose.prod.yml --env-file .env exec -T postgres sh -c ${shellQuote('pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"')} < /dev/null | gzip > ${shellQuote(tmp)} && ` +
    `gzip -t ${shellQuote(tmp)} && [ "$(wc -c < ${shellQuote(tmp)})" -gt 200 ] && mv ${shellQuote(tmp)} ${shellQuote(outPath)}`;
  return `bash -c ${shellQuote(`${inner} || { rm -f ${shellQuote(tmp)}; exit 1; }`)}`;
}
