ALTER TABLE "servers" ADD COLUMN "memory_guard_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "memory_guard_threshold" integer DEFAULT 92 NOT NULL;--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "memory_guard_recover" integer DEFAULT 80 NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "priority" varchar(16) DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "shed_by_guard" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "priority" varchar(16) DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "shed_by_guard" boolean DEFAULT false NOT NULL;