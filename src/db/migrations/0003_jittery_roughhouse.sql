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
ALTER TABLE "dm_batches" ADD CONSTRAINT "dm_batches_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dm_jobs" ADD CONSTRAINT "dm_jobs_batch_id_dm_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."dm_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dm_jobs" ADD CONSTRAINT "dm_jobs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dm_batches_user_id_idx" ON "dm_batches" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "dm_batches_status_idx" ON "dm_batches" USING btree ("status");--> statement-breakpoint
CREATE INDEX "dm_jobs_batch_id_idx" ON "dm_jobs" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "dm_jobs_user_id_idx" ON "dm_jobs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "dm_jobs_status_idx" ON "dm_jobs" USING btree ("status");
