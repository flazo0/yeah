import { and, isNotNull, lt, ne } from "drizzle-orm";
import { auditEvents, backupExecutions, deployments, dockerCleanupExecutions, platformOperations, scheduledTaskExecutions, volumeBackups } from "@yeah/db";
import type { LogRetentionJobData } from "@yeah/queue";
import type { Job } from "bullmq";
import { db } from "../lib/db";

const DEFAULT_RETENTION_DAYS = 90;

/** `LOG_RETENTION_DAYS=0` turns the sweep off entirely — null means "don't touch anything". */
export function retentionCutoff(now: Date, envValue: string | undefined): Date | null {
  const days = envValue === undefined || envValue === "" ? DEFAULT_RETENTION_DAYS : Number(envValue);
  if (!Number.isFinite(days) || days <= 0) return null;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

// Every execution-history table that stores a free-form log: the log text is almost always the
// bulk of the row, and nobody needs a deploy's full build output a year later — clearing it (not
// deleting the row) keeps status/timing/size history intact while reclaiming the disk/vacuum cost.
const LOG_TABLES = [deployments, backupExecutions, dockerCleanupExecutions, platformOperations, scheduledTaskExecutions, volumeBackups] as const;

/** Audit entries are tiny and valuable: kept a year by default (`AUDIT_RETENTION_DAYS`, 0 = forever). */
export function auditCutoff(now: Date, envValue: string | undefined): Date | null {
  const days = envValue === undefined || envValue === "" ? 365 : Number(envValue);
  if (!Number.isFinite(days) || days <= 0) return null;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

export function makeLogRetentionProcessor() {
  return async function logRetention(_job: Job<LogRetentionJobData>) {
    const audit = auditCutoff(new Date(), process.env.AUDIT_RETENTION_DAYS);
    if (audit) await db.delete(auditEvents).where(lt(auditEvents.createdAt, audit));
    const cutoff = retentionCutoff(new Date(), process.env.LOG_RETENTION_DAYS);
    if (!cutoff) return;
    for (const table of LOG_TABLES) {
      await db
        .update(table)
        .set({ log: "" })
        .where(and(isNotNull(table.finishedAt), lt(table.finishedAt, cutoff), ne(table.log, "")));
    }
  };
}
