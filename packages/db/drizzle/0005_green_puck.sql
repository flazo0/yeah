CREATE TABLE "s3_storages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"endpoint" varchar(512),
	"region" varchar(100) DEFAULT 'us-east-1' NOT NULL,
	"bucket" varchar(255) NOT NULL,
	"access_key_id" varchar(255) NOT NULL,
	"secret_access_key" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "backup_executions" ADD COLUMN "s3_storage_id" uuid;--> statement-breakpoint
ALTER TABLE "backup_schedules" ADD COLUMN "storage_id" uuid;--> statement-breakpoint
ALTER TABLE "s3_storages" ADD CONSTRAINT "s3_storages_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_executions" ADD CONSTRAINT "backup_executions_s3_storage_id_s3_storages_id_fk" FOREIGN KEY ("s3_storage_id") REFERENCES "public"."s3_storages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_schedules" ADD CONSTRAINT "backup_schedules_storage_id_s3_storages_id_fk" FOREIGN KEY ("storage_id") REFERENCES "public"."s3_storages"("id") ON DELETE set null ON UPDATE no action;