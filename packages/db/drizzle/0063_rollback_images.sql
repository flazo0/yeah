ALTER TABLE "applications" ADD COLUMN "rollback_images" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "rollback_image" text;