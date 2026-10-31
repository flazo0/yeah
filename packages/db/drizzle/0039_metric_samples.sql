CREATE TYPE "public"."metric_resource_type" AS ENUM('application', 'database', 'service');--> statement-breakpoint
CREATE TABLE "container_metric_samples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"resource_type" "metric_resource_type" NOT NULL,
	"resource_id" uuid NOT NULL,
	"cpu_percent" real NOT NULL,
	"mem_percent" real NOT NULL,
	"mem_used_bytes" bigint NOT NULL,
	"net_rx_bytes" bigint NOT NULL,
	"net_tx_bytes" bigint NOT NULL,
	"pids" integer NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "server_metric_samples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"cpu_percent" real NOT NULL,
	"mem_percent" real NOT NULL,
	"disk_percent" real NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "container_metric_samples" ADD CONSTRAINT "container_metric_samples_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_metric_samples" ADD CONSTRAINT "server_metric_samples_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "container_metric_samples_resource_time_idx" ON "container_metric_samples" USING btree ("resource_type","resource_id","captured_at");--> statement-breakpoint
CREATE INDEX "server_metric_samples_server_time_idx" ON "server_metric_samples" USING btree ("server_id","captured_at");