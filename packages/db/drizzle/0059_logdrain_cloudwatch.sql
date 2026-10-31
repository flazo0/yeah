ALTER TYPE "public"."log_drain_kind" ADD VALUE 'cloudwatch';--> statement-breakpoint
ALTER TABLE "log_drains" ADD COLUMN "aws_region" varchar(32);--> statement-breakpoint
ALTER TABLE "log_drains" ADD COLUMN "aws_access_key_id" varchar(128);--> statement-breakpoint
ALTER TABLE "log_drains" ADD COLUMN "aws_secret_access_key" text;--> statement-breakpoint
ALTER TABLE "log_drains" ADD COLUMN "aws_log_group" varchar(512);--> statement-breakpoint
ALTER TABLE "log_drains" ADD COLUMN "aws_log_stream" varchar(512);