ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "tweet_count" integer;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "listed_count" integer;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "verified" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "verified_type" text;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "location" text;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "url" text;
