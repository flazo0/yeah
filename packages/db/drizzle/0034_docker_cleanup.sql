CREATE TABLE "docker_cleanup_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"status" "backup_execution_status" DEFAULT 'queued' NOT NULL,
	"log" text DEFAULT '' NOT NULL,
	"reclaimed_bytes" bigint,
	"manual" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "docker_cleanups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"cron" varchar(100) DEFAULT '0 4 * * 0' NOT NULL,
	"timezone" varchar(100) DEFAULT 'UTC' NOT NULL,
	"prune_images" boolean DEFAULT false NOT NULL,
	"prune_volumes" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "docker_cleanups_server_id_unique" UNIQUE("server_id")
);
--> statement-breakpoint
ALTER TABLE "docker_cleanup_executions" ADD CONSTRAINT "docker_cleanup_executions_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docker_cleanups" ADD CONSTRAINT "docker_cleanups_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;