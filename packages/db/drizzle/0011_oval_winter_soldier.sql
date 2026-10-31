ALTER TYPE "public"."notification_channel_type" ADD VALUE 'email';--> statement-breakpoint
ALTER TABLE "notification_channels" ADD COLUMN "smtp_host" varchar(255);--> statement-breakpoint
ALTER TABLE "notification_channels" ADD COLUMN "smtp_port" integer;--> statement-breakpoint
ALTER TABLE "notification_channels" ADD COLUMN "smtp_secure" boolean;--> statement-breakpoint
ALTER TABLE "notification_channels" ADD COLUMN "smtp_user" varchar(255);--> statement-breakpoint
ALTER TABLE "notification_channels" ADD COLUMN "smtp_password" varchar(255);--> statement-breakpoint
ALTER TABLE "notification_channels" ADD COLUMN "smtp_from" varchar(255);--> statement-breakpoint
ALTER TABLE "notification_channels" ADD COLUMN "email_to" varchar(255);