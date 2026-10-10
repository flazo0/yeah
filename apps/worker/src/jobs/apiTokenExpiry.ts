import { and, eq, isNotNull, isNull, lte } from "drizzle-orm";
import { apiTokens } from "@yeah/db";
import type { ApiTokenExpiryJobData } from "@yeah/queue";
import type { Job } from "bullmq";
import { db } from "../lib/db";
import { notifyTeam } from "../lib/notify";

const WARNING_WINDOW_DAYS = 7;

/** Tick job, no per-run data — warns once per token as it nears its expiry date. */
export function makeApiTokenExpiryProcessor() {
  return async function apiTokenExpiry(_job: Job<ApiTokenExpiryJobData>) {
    const cutoff = new Date(Date.now() + WARNING_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const rows = await db
      .select()
      .from(apiTokens)
      .where(and(isNotNull(apiTokens.expiresAt), lte(apiTokens.expiresAt, cutoff), isNull(apiTokens.expiryWarningSentAt)));

    for (const token of rows) {
      const daysRemaining = Math.max(0, Math.ceil((token.expiresAt!.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
      await notifyTeam(
        token.teamId,
        "api-token.expiring",
        `Token de API "${token.name}" expira em ${daysRemaining} dia(s)`,
        daysRemaining <= 0
          ? `O token "${token.name}" (${token.tokenPrefix}…) já expirou ou expira hoje — gere um novo em Keys & Tokens antes que scripts/CI que dependem dele parem de funcionar.`
          : `O token "${token.name}" (${token.tokenPrefix}…) expira em ${daysRemaining} dia(s). Gere um novo em Keys & Tokens com tempo de sobra se algo ainda depende dele.`,
        daysRemaining <= 0 ? "error" : "warning",
      );
      await db.update(apiTokens).set({ expiryWarningSentAt: new Date() }).where(eq(apiTokens.id, token.id));
    }
  };
}
