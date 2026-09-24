ALTER TYPE "public"."build_pack" ADD VALUE 'docker_compose';--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "compose_file" varchar(255) DEFAULT 'docker-compose.yml' NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "compose_service" varchar(64);