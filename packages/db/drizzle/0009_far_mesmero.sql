ALTER TABLE "applications" ADD COLUMN "memory_limit_mb" integer;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "cpu_limit" real;--> statement-breakpoint
ALTER TABLE "databases" ADD COLUMN "memory_limit_mb" integer;--> statement-breakpoint
ALTER TABLE "databases" ADD COLUMN "cpu_limit" real;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "memory_limit_mb" integer;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "cpu_limit" real;