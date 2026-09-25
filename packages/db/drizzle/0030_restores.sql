CREATE TABLE "database_restores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"database_id" uuid NOT NULL,
	"status" "backup_execution_status" DEFAULT 'queued' NOT NULL,
	"source_label" varchar(512) NOT NULL,
	"log" text DEFAULT '' NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "backup_schedules" ADD COLUMN "databases_to_include" varchar(1000);--> statement-breakpoint
ALTER TABLE "database_restores" ADD CONSTRAINT "database_restores_database_id_databases_id_fk" FOREIGN KEY ("database_id") REFERENCES "public"."databases"("id") ON DELETE cascade ON UPDATE no action;