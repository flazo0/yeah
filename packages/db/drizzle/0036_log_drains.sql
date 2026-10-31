CREATE TYPE "public"."log_drain_kind" AS ENUM('loki', 'axiom', 'new_relic', 'fluent_bit_http');--> statement-breakpoint
CREATE TABLE "log_drains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"kind" "log_drain_kind" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"url" varchar(1024),
	"loki_username" varchar(255),
	"loki_password" text,
	"axiom_dataset" varchar(255),
	"axiom_token" text,
	"new_relic_license_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "log_drains" ADD CONSTRAINT "log_drains_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;