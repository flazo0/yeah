ALTER TABLE "instance_settings" ADD COLUMN "backup_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "backup_storage_id" uuid;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "backup_hour_utc" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "backup_retention" integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "backup_last_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "backup_last_status" varchar(16);--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "backup_last_error" varchar(500);--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "backup_last_size_bytes" integer;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD CONSTRAINT "instance_settings_backup_storage_id_s3_storages_id_fk" FOREIGN KEY ("backup_storage_id") REFERENCES "public"."s3_storages"("id") ON DELETE set null ON UPDATE no action;