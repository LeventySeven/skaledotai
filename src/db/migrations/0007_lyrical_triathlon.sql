CREATE TABLE "contra" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"handle" text NOT NULL,
	"name" text NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"platform" text DEFAULT 'twitter' NOT NULL,
	"followers" integer DEFAULT 0,
	"following" integer,
	"avatar_url" text,
	"profile_url" text,
	"url" text,
	"site" text,
	"linkedin_url" text,
	"email" text,
	"price" integer,
	"budget" numeric(10, 2),
	"tags" text[] DEFAULT '{}' NOT NULL,
	"deliverables" text[] DEFAULT '{}' NOT NULL,
	"relevancy" text DEFAULT 'low',
	"notes" text,
	"source" text,
	"reached_out" boolean DEFAULT false NOT NULL,
	"stage" text DEFAULT 'found' NOT NULL,
	"priority" text DEFAULT 'P1' NOT NULL,
	"dm_comfort" boolean DEFAULT false NOT NULL,
	"the_ask" text DEFAULT '' NOT NULL,
	"in_outreach" boolean DEFAULT false NOT NULL,
	"discovery_source" text,
	"discovery_query" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "contra_user_id_idx" ON "contra" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "contra_handle_idx" ON "contra" USING btree ("handle");--> statement-breakpoint
CREATE INDEX "contra_stage_idx" ON "contra" USING btree ("stage");--> statement-breakpoint
CREATE INDEX "contra_relevancy_idx" ON "contra" USING btree ("relevancy");--> statement-breakpoint
CREATE UNIQUE INDEX "contra_handle_platform_idx" ON "contra" USING btree ("handle","platform");