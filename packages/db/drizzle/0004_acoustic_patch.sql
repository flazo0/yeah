ALTER TYPE "public"."database_engine" ADD VALUE 'mysql';--> statement-breakpoint
ALTER TYPE "public"."database_engine" ADD VALUE 'mariadb';--> statement-breakpoint
ALTER TYPE "public"."database_engine" ADD VALUE 'redis';--> statement-breakpoint
ALTER TYPE "public"."database_engine" ADD VALUE 'mongodb';--> statement-breakpoint
ALTER TABLE "databases" ALTER COLUMN "username" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "databases" ALTER COLUMN "username" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "databases" ALTER COLUMN "database_name" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "databases" ALTER COLUMN "database_name" DROP NOT NULL;