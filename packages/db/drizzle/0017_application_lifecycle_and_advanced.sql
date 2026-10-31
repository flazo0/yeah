ALTER TYPE "public"."application_status" ADD VALUE 'stopped' BEFORE 'error';--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "health_path" varchar(255);--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "health_interval_seconds" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "health_timeout_seconds" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "health_retries" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "health_start_period_seconds" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "docker_options" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "stop_grace_seconds" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "deploy_token_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_deploy_token_hash_unique" UNIQUE("deploy_token_hash");