CREATE TYPE "public"."volume_backup_operation" AS ENUM('backup', 'restore');--> statement-breakpoint
CREATE TYPE "public"."volume_backup_owner" AS ENUM('application', 'service');--> statement-breakpoint
CREATE TABLE "volume_backups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"owner_type" "volume_backup_owner" NOT NULL,
	"owner_id" uuid NOT NULL,
	"volume_id" uuid,
	"label" varchar(512) NOT NULL,
	"operation" "volume_backup_operation" DEFAULT 'backup' NOT NULL,
	"status" "backup_execution_status" DEFAULT 'queued' NOT NULL,
	"log" text DEFAULT '' NOT NULL,
	"file_path" varchar(1024),
	"size_bytes" bigint,
	"source_backup_id" uuid,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "volume_backups" ADD CONSTRAINT "volume_backups_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;