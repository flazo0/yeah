CREATE TYPE "public"."git_provider" AS ENUM('gitlab', 'bitbucket', 'gitea');--> statement-breakpoint
CREATE TABLE "git_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"provider" "git_provider" NOT NULL,
	"name" varchar(255) NOT NULL,
	"base_url" varchar(255) NOT NULL,
	"username" varchar(255) DEFAULT '' NOT NULL,
	"token" text NOT NULL,
	"webhook_secret" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "git_sources_team_name_unique" UNIQUE("team_id","name")
);
--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "git_source_id" uuid;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "git_repo" varchar(255);--> statement-breakpoint
ALTER TABLE "git_sources" ADD CONSTRAINT "git_sources_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_git_source_id_git_sources_id_fk" FOREIGN KEY ("git_source_id") REFERENCES "public"."git_sources"("id") ON DELETE set null ON UPDATE no action;