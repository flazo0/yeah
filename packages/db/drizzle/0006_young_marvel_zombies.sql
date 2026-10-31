CREATE TYPE "public"."proxy_status" AS ENUM('inactive', 'provisioning', 'active', 'error');--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "wildcard_domain" varchar(255);--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "acme_email" varchar(255);--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "proxy_status" "proxy_status" DEFAULT 'inactive' NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "domain" varchar(255);