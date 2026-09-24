CREATE TYPE "public"."shared_variable_scope" AS ENUM('team', 'project', 'environment');--> statement-breakpoint
CREATE TABLE "shared_variables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"scope" "shared_variable_scope" NOT NULL,
	"project_id" uuid,
	"environment_id" uuid,
	"key" varchar(255) NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shared_variables_unique_key" UNIQUE NULLS NOT DISTINCT("team_id","scope","project_id","environment_id","key")
);
--> statement-breakpoint
ALTER TABLE "shared_variables" ADD CONSTRAINT "shared_variables_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_variables" ADD CONSTRAINT "shared_variables_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_variables" ADD CONSTRAINT "shared_variables_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;