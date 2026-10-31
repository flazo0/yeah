CREATE TYPE "public"."platform_operation_kind" AS ENUM('platform_update', 'system_update');--> statement-breakpoint
CREATE TYPE "public"."platform_operation_status" AS ENUM('queued', 'running', 'success', 'failed');--> statement-breakpoint
CREATE TABLE "platform_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "platform_operation_kind" NOT NULL,
	"status" "platform_operation_status" DEFAULT 'queued' NOT NULL,
	"log" text DEFAULT '' NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "is_platform_host" boolean DEFAULT false NOT NULL;