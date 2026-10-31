CREATE TABLE "instance_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"panel_domain" varchar(255),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
