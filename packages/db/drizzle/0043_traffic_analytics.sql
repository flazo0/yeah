CREATE TABLE "application_traffic_samples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"request_count" bigint NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "traffic_analytics_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "application_traffic_samples" ADD CONSTRAINT "application_traffic_samples_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "application_traffic_samples_app_time_idx" ON "application_traffic_samples" USING btree ("application_id","captured_at");