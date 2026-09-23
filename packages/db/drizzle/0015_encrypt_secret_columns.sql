ALTER TABLE "servers" ALTER COLUMN "private_key" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "databases" ALTER COLUMN "password" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "s3_storages" ALTER COLUMN "secret_access_key" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "notification_channels" ALTER COLUMN "url" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "notification_channels" ALTER COLUMN "telegram_bot_token" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "notification_channels" ALTER COLUMN "smtp_password" SET DATA TYPE text;