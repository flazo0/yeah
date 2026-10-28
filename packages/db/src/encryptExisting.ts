import { eq, sql } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { Db } from "./client";
import { decryptSecret, isEncrypted, usesCurrentKey } from "./encryption";
import {
  applicationVolumes,
  applications,
  databases,
  gitSources,
  logDrains,
  notificationChannels,
  registries,
  s3Storages,
  servers,
  services,
  sharedVariables,
  sshKeys,
  users,
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
  { label: "applications.deploy_key", table: applications, column: applications.deployKey, key: "deployKey" },
  { label: "servers.cloudflare_tunnel_token", table: servers, column: servers.cloudflareTunnelToken, key: "cloudflareTunnelToken" },
  { label: "notification_channels.pushover_user_key", table: notificationChannels, column: notificationChannels.pushoverUserKey, key: "pushoverUserKey" },
  { label: "notification_channels.pushover_api_token", table: notificationChannels, column: notificationChannels.pushoverApiToken, key: "pushoverApiToken" },
  { label: "registries.password", table: registries, column: registries.password, key: "password" },
  { label: "ssh_keys.private_key", table: sshKeys, column: sshKeys.privateKey, key: "privateKey" },
  { label: "git_sources.token", table: gitSources, column: gitSources.token, key: "token" },
  { label: "git_sources.webhook_secret", table: gitSources, column: gitSources.webhookSecret, key: "webhookSecret" },
  { label: "log_drains.loki_password", table: logDrains, column: logDrains.lokiPassword, key: "lokiPassword" },
  { label: "log_drains.axiom_token", table: logDrains, column: logDrains.axiomToken, key: "axiomToken" },
  { label: "log_drains.new_relic_license_key", table: logDrains, column: logDrains.newRelicLicenseKey, key: "newRelicLicenseKey" },
  { label: "shared_variables.value", table: sharedVariables, column: sharedVariables.value, key: "value" },
  { label: "users.totp_secret", table: users, column: users.totpSecret, key: "totpSecret" },
  { label: "application_volumes.file_content", table: applicationVolumes, column: applicationVolumes.fileContent, key: "fileContent" },
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

/**
 * After rotating ENCRYPTION_KEY (old value moved to ENCRYPTION_KEY_PREVIOUS): rewrites every secret that is
 * still encrypted with a previous key so it uses the current one, after which the old key can be dropped.
 * Idempotent; a value that no key can decrypt is reported and left untouched.
 */
export async function reencryptSecrets(db: Db): Promise<{ rewritten: number; failed: string[] }> {
  let rewritten = 0;
  const failed: string[] = [];
  for (const { label, table, column, key } of SECRET_COLUMNS) {
    const rows = (await db
      .select({ id: table.id, value: sql<string>`${column}` })
      .from(table)
      .where(sql`${column} like enc:v1:%`)) as { id: string; value: string }[];
    for (const row of rows) {
      if (usesCurrentKey(row.value)) continue;
      try {
        const plaintext = decryptSecret(row.value);
        await db.update(table).set({ [key]: plaintext } as never).where(eq(table.id, row.id));
        rewritten++;
      } catch (err) {
        failed.push(`${label} (${row.id}): ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  return { rewritten, failed };
}
