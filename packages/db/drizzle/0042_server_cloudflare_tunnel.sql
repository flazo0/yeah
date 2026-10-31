ALTER TABLE "servers" ADD COLUMN "cloudflare_tunnel_token" text;--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "cloudflare_tunnel_status" "proxy_status" DEFAULT 'inactive' NOT NULL;--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "cloudflare_tunnel_error" varchar(1000);