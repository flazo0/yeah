ALTER TYPE "public"."notification_channel_type" ADD VALUE 'pushover';--> statement-breakpoint
ALTER TABLE "notification_channels" ADD COLUMN "pushover_user_key" text;--> statement-breakpoint
ALTER TABLE "notification_channels" ADD COLUMN "pushover_api_token" text;