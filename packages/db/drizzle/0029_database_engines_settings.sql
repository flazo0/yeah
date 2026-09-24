ALTER TYPE "public"."database_engine" ADD VALUE 'keydb' BEFORE 'mongodb';--> statement-breakpoint
ALTER TYPE "public"."database_engine" ADD VALUE 'dragonfly' BEFORE 'mongodb';--> statement-breakpoint
ALTER TYPE "public"."database_engine" ADD VALUE 'clickhouse';--> statement-breakpoint
ALTER TABLE "databases" ADD COLUMN "public_access" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "databases" ADD COLUMN "ssl" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "databases" ADD COLUMN "health_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "databases" ADD COLUMN "health_interval_seconds" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "databases" ADD COLUMN "health_timeout_seconds" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "databases" ADD COLUMN "health_retries" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
-- Databases created before this migration always published their port; keep them reachable exactly as before (new ones start private).
UPDATE "databases" SET "public_access" = true;
