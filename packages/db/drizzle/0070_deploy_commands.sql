ALTER TABLE "applications" ADD COLUMN "pre_deploy_command" varchar(1000);--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "post_deploy_command" varchar(1000);