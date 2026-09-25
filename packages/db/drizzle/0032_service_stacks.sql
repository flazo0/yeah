ALTER TYPE "public"."service_status" ADD VALUE 'stopped' BEFORE 'error';--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "compose_content" text;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "template_key" varchar(100);--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "main_service" varchar(64);--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "domains" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "last_log" text DEFAULT '' NOT NULL;