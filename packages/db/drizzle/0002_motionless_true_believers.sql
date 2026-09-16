CREATE TYPE "public"."database_engine" AS ENUM('postgresql');--> statement-breakpoint
CREATE TYPE "public"."database_status" AS ENUM('idle', 'provisioning', 'running', 'error');--> statement-breakpoint
CREATE TYPE "public"."backup_execution_status" AS ENUM('queued', 'running', 'success', 'failed');--> statement-breakpoint
CREATE TABLE "databases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"server_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"engine" "database_engine" DEFAULT 'postgresql' NOT NULL,
	"image" varchar(255) DEFAULT 'postgres:16-alpine' NOT NULL,
	"port" integer DEFAULT 5432 NOT NULL,
	"username" varchar(255) DEFAULT 'postgres' NOT NULL,
	"password" varchar(255) NOT NULL,
	"database_name" varchar(255) DEFAULT 'app' NOT NULL,
	"status" "database_status" DEFAULT 'idle' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backup_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" uuid NOT NULL,
	"status" "backup_execution_status" DEFAULT 'queued' NOT NULL,
	"log" text DEFAULT '' NOT NULL,
	"file_path" varchar(1024),
	"size_bytes" bigint,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backup_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"database_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"cron" varchar(100) NOT NULL,
	"timezone" varchar(100) DEFAULT 'UTC' NOT NULL,
	"timeout_seconds" integer DEFAULT 3600 NOT NULL,
	"retention_count" integer DEFAULT 7 NOT NULL,
	"retention_days" integer DEFAULT 0 NOT NULL,
	"retention_size_gb" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "databases" ADD CONSTRAINT "databases_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "databases" ADD CONSTRAINT "databases_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_executions" ADD CONSTRAINT "backup_executions_schedule_id_backup_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."backup_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_schedules" ADD CONSTRAINT "backup_schedules_database_id_databases_id_fk" FOREIGN KEY ("database_id") REFERENCES "public"."databases"("id") ON DELETE cascade ON UPDATE no action;