import { eq } from "drizzle-orm";
import { logDrains } from "@yeah/db";
import { sendLogs, splitLogLines } from "@yeah/logdrains";
import { db } from "./db";

/**
 * Forwards one job's full log (already captured — a deploy, a scheduled task run) to every enabled
 * log drain of the team, split into lines with the same labels throughout. Best-effort and fired
 * after the job already recorded its own result — a drain being down never affects the job itself.
 */
export async function forwardJobLog(teamId: string, log: string, labels: Record<string, string>): Promise<void> {
  const lines = splitLogLines(log);
  if (lines.length === 0) return;
  const drains = await db.select().from(logDrains).where(eq(logDrains.teamId, teamId));
  const now = new Date();
  await Promise.all(
    drains
      .filter((d) => d.enabled)
      .map((d) =>
        sendLogs(
          d,
          lines.map((message) => ({ message, timestamp: now, labels })),
        ),
      ),
  );
}
