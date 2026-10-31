ALTER TABLE "applications" ADD COLUMN "preview_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "preview_of_id" uuid;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "pr_number" integer;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_preview_of_id_applications_id_fk" FOREIGN KEY ("preview_of_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;