ALTER TABLE "servers" ADD COLUMN "error_page_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "error_page_title" varchar(120);--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "error_page_message" varchar(500);--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "maintenance_mode" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "maintenance_message" varchar(500);--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "maintenance_containers" jsonb DEFAULT '[]'::jsonb NOT NULL;