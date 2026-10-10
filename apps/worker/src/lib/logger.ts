import type { Worker } from "bullmq";
import { createLogger, parseLogLevel } from "@yeah/shared";

export const log = createLogger("worker", {
  format: process.env.LOG_FORMAT === "text" ? "text" : "json",
  minLevel: parseLogLevel(process.env.LOG_LEVEL),
});

/** One structured line per finished/failed job, keyed by queue and `jobId` so a deploy can be followed across log lines. */
export function logJobEvents(worker: Worker, queue: string, logCompleted = false) {
  if (logCompleted) worker.on("completed", (job) => log.info("job completed", { queue, jobId: job.id }));
  worker.on("failed", (job, err) => log.error("job failed", { queue, jobId: job?.id, err }));
}
