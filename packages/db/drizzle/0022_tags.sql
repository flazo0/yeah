CREATE TYPE "public"."taggable_type" AS ENUM('application', 'database', 'service');--> statement-breakpoint
CREATE TABLE "resource_tags" (
	"tag_id" uuid NOT NULL,
	"resource_type" "taggable_type" NOT NULL,
	"resource_id" uuid NOT NULL,
	CONSTRAINT "resource_tags_tag_id_resource_type_resource_id_pk" PRIMARY KEY("tag_id","resource_type","resource_id")
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"name" varchar(50) NOT NULL,
	"color" varchar(7) DEFAULT '#6366f1' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tags_team_name_unique" UNIQUE("team_id","name")
);
--> statement-breakpoint
ALTER TABLE "resource_tags" ADD CONSTRAINT "resource_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;