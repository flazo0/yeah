CREATE TYPE "public"."application_status" AS ENUM('idle', 'deploying', 'running', 'error');--> statement-breakpoint
CREATE TYPE "public"."build_pack" AS ENUM('dockerfile');--> statement-breakpoint
CREATE TYPE "public"."deployment_status" AS ENUM('queued', 'running', 'success', 'failed');--> statement-breakpoint
CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"server_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"repo_url" varchar(1024) NOT NULL,
	"branch" varchar(255) DEFAULT 'main' NOT NULL,
	"build_pack" "build_pack" DEFAULT 'dockerfile' NOT NULL,
	"port" integer DEFAULT 3000 NOT NULL,
	"env_content" text DEFAULT '' NOT NULL,
	"status" "application_status" DEFAULT 'idle' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deployments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"status" "deployment_status" DEFAULT 'queued' NOT NULL,
	"log" text DEFAULT '' NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;