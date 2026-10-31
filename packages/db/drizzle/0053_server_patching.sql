ALTER TABLE "servers" ADD COLUMN "patch_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "patch_updates" integer;--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "patch_security" integer;--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "patch_reboot_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "patch_packages" jsonb;--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "patch_notified_security" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "auto_security_updates" boolean DEFAULT false NOT NULL;