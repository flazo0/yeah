CREATE TYPE "public"."notification_channel_type" AS ENUM('discord', 'slack', 'telegram', 'webhook');--> statement-breakpoint
CREATE TYPE "public"."service_status" AS ENUM('idle', 'provisioning', 'running', 'error');--> statement-breakpoint
CREATE TABLE "notification_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"type" "notification_channel_type" NOT NULL,
	"url" varchar(1024),
	"telegram_bot_token" varchar(255),
	"telegram_chat_id" varchar(255),
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"environment_id" uuid NOT NULL,
	"server_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"catalog_key" varchar(100) NOT NULL,
	"image" varchar(255) NOT NULL,
	"port" integer NOT NULL,
	"env_content" text DEFAULT '' NOT NULL,
	"domain" varchar(255),
	"status" "service_status" DEFAULT 'idle' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "cpu_percent" real;--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "mem_percent" real;--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "disk_percent" real;--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "metrics_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification_channels" ADD CONSTRAINT "notification_channels_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;