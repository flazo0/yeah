import { eq, sql } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { Db } from "./client";
import { isEncrypted } from "./encryption";
import {
  applications,
  databases,
  notificationChannels,
  s3Storages,
  servers,
  services,
} from "./schema";

interface SecretColumn {
  label: string;
  table: PgTable & { id: PgColumn };
  column: PgColumn;
  key: string;
}

const SECRET_COLUMNS: SecretColumn[] = [
  { label: "servers.private_key", table: servers, column: servers.privateKey, key: "privateKey" },
  { label: "databases.password", table: databases, column: databases.password, key: "password" },
  { label: "s3_storages.secret_access_key", table: s3Storages, column: s3Storages.secretAccessKey, key: "secretAccessKey" },
  { label: "notification_channels.url", table: notificationChannels, column: notificationChannels.url, key: "url" },
  { label: "notification_channels.telegram_bot_token", table: notificationChannels, column: notificationChannels.telegramBotToken, key: "telegramBotToken" },
  { label: "notification_channels.smtp_password", table: notificationChannels, column: notificationChannels.smtpPassword, key: "smtpPassword" },
  { label: "applications.env_content", table: applications, column: applications.envContent, key: "envContent" },
  { label: "services.env_content", table: services, column: services.envContent, key: "envContent" },
];

/**
 * Rewrites any secret still stored as plaintext (rows from before encryption existed) through the
 * encrypted column type. Idempotent — already-encrypted rows are skipped by the WHERE clause, so it
 * is safe to run on every API start. A row that fails is logged and retried on the next start.
 */
export async function encryptExistingSecrets(db: Db): Promise<number> {
  let total = 0;
  for (const { label, table, column, key } of SECRET_COLUMNS) {
    // Raw `sql` on purpose: selecting through the column object would decrypt/decode the value.
    const rows = (await db
      .select({ id: table.id, value: sql<string>`${column}` })
      .from(table)
      .where(sql`${column} is not null and ${column} <> '' and ${column} not like 'enc:v1:%'`)) as {
      id: string;
      value: string;
    }[];
    for (const row of rows) {
      if (isEncrypted(row.value)) continue;
      try {
        await db
          .update(table)
          .set({ [key]: row.value } as never)
          .where(eq(table.id, row.id));
        total++;
      } catch (err) {
        console.error(`[db] failed to encrypt ${label} for row ${row.id}:`, err instanceof Error ? err.message : err);
      }
    }
  }
  return total;
}
