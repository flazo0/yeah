ALTER TABLE "applications" ADD COLUMN "basic_auth_user" varchar(64);--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "basic_auth_hash" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "maintenance_mode" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "maintenance_message" varchar(500);