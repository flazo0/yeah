CREATE TABLE "registries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"host" varchar(255) NOT NULL,
	"username" varchar(255) NOT NULL,
	"password" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registries_team_name_unique" UNIQUE("team_id","name")
);
--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "registry_id" uuid;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "registry_image" varchar(255);--> statement-breakpoint
ALTER TABLE "registries" ADD CONSTRAINT "registries_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_registry_id_registries_id_fk" FOREIGN KEY ("registry_id") REFERENCES "public"."registries"("id") ON DELETE set null ON UPDATE no action;