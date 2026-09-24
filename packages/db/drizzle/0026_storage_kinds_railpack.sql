CREATE TYPE "public"."volume_kind" AS ENUM('volume', 'bind', 'file');--> statement-breakpoint
ALTER TYPE "public"."build_pack" ADD VALUE 'railpack' BEFORE 'image';--> statement-breakpoint
ALTER TABLE "application_volumes" ADD COLUMN "kind" "volume_kind" DEFAULT 'volume' NOT NULL;--> statement-breakpoint
ALTER TABLE "application_volumes" ADD COLUMN "host_path" varchar(512);--> statement-breakpoint
ALTER TABLE "application_volumes" ADD COLUMN "file_content" text;