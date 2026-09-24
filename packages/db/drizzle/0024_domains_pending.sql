CREATE TYPE "public"."www_redirect" AS ENUM('none', 'www_to_root', 'root_to_www');--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "extra_domains" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "www_redirect" "www_redirect" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "deployed_config" jsonb;