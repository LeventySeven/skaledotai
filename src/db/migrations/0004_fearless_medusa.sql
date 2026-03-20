CREATE TABLE "dm_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"total_count" integer DEFAULT 0 NOT NULL,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "dm_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"lead_id" text NOT NULL,
	"x_user_id" text NOT NULL,
	"message" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"retryable" boolean DEFAULT false NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"dm_event_id" text,
	"dm_conversation_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "internal_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"handle" text NOT NULL,
	"platform" text DEFAULT 'twitter' NOT NULL,
	"deliverables" text[] DEFAULT '{}' NOT NULL,
	"url" text,
	"email" text,
	"price" integer,
	"notes" text,
	"bio" text DEFAULT '' NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"relevancy" integer DEFAULT 0 NOT NULL,
	"source_lead_id" uuid,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_runs" ADD COLUMN "min_followers" integer;--> statement-breakpoint
ALTER TABLE "project_runs" ADD COLUMN "target_lead_count" integer;--> statement-breakpoint
ALTER TABLE "project_runs" ADD COLUMN "trace_data" jsonb;--> statement-breakpoint
ALTER TABLE "project_runs" ADD COLUMN "status" text DEFAULT 'completed' NOT NULL;--> statement-breakpoint
ALTER TABLE "dm_batches" ADD CONSTRAINT "dm_batches_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dm_jobs" ADD CONSTRAINT "dm_jobs_batch_id_dm_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."dm_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dm_jobs" ADD CONSTRAINT "dm_jobs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_leads" ADD CONSTRAINT "internal_leads_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_leads" ADD CONSTRAINT "internal_leads_source_lead_id_leads_id_fk" FOREIGN KEY ("source_lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dm_batches_user_id_idx" ON "dm_batches" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "dm_batches_status_idx" ON "dm_batches" USING btree ("status");--> statement-breakpoint
CREATE INDEX "dm_jobs_batch_id_idx" ON "dm_jobs" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "dm_jobs_user_id_idx" ON "dm_jobs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "dm_jobs_status_idx" ON "dm_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "internal_leads_user_id_idx" ON "internal_leads" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "internal_leads_user_handle_platform_idx" ON "internal_leads" USING btree ("user_id","handle","platform");