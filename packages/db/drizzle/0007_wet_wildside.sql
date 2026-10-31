CREATE TABLE "github_installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"installation_id" integer NOT NULL,
	"account_login" varchar(255) NOT NULL,
	"account_type" varchar(50) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "github_installations_team_id_unique" UNIQUE("team_id")
);
--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "github_installation_id" integer;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "github_repo" varchar(255);--> statement-breakpoint
ALTER TABLE "github_installations" ADD CONSTRAINT "github_installations_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;