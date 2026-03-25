CREATE TABLE "follower_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seed_handle" text NOT NULL,
	"seed_user_id" text,
	"status" text DEFAULT 'fetching' NOT NULL,
	"total_fetched" integer DEFAULT 0 NOT NULL,
	"last_cursor" text,
	"last_updated_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "follower_cache_seed_handle_idx" ON "follower_cache" USING btree ("seed_handle");
