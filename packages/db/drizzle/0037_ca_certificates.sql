CREATE TABLE "ca_certificates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"host" varchar(255) NOT NULL,
	"pem" text NOT NULL,
	"status" "backup_execution_status" DEFAULT 'queued' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ca_certificates_server_host_unique" UNIQUE("server_id","host")
);
--> statement-breakpoint
ALTER TABLE "ca_certificates" ADD CONSTRAINT "ca_certificates_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;