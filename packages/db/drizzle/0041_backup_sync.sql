ALTER TABLE "backup_executions" ADD COLUMN "synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "backup_schedules" ADD COLUMN "auto_sync_keep_count" integer;