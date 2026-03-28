CREATE TABLE "monitored_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"handle" text NOT NULL,
	"name" text NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"platform" text DEFAULT 'twitter' NOT NULL,
	"followers" integer DEFAULT 0 NOT NULL,
	"avatar_url" text,
	"x_user_id" text,
	"source_table" text NOT NULL,
	"source_id" text NOT NULL,
	"monitoring" boolean DEFAULT true NOT NULL,
	"response_status" text DEFAULT 'reached_out' NOT NULL,
	"last_dm_check" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "monitored_leads" ADD CONSTRAINT "monitored_leads_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "monitored_leads_user_id_idx" ON "monitored_leads" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "monitored_leads_user_handle_idx" ON "monitored_leads" USING btree ("user_id","handle","platform");--> statement-breakpoint
CREATE INDEX "monitored_leads_monitoring_idx" ON "monitored_leads" USING btree ("monitoring");--> statement-breakpoint
CREATE INDEX "monitored_leads_response_status_idx" ON "monitored_leads" USING btree ("response_status");