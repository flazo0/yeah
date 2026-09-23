ALTER TYPE "public"."build_pack" ADD VALUE 'static';--> statement-breakpoint
ALTER TYPE "public"."build_pack" ADD VALUE 'nixpacks';--> statement-breakpoint
ALTER TYPE "public"."build_pack" ADD VALUE 'image';--> statement-breakpoint
ALTER TYPE "public"."build_pack" ADD VALUE 'dockerfile_inline';--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "docker_image" varchar(512);--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "dockerfile_content" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "publish_directory" varchar(255) DEFAULT '.' NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "deploy_key" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "deploy_key_public" text;