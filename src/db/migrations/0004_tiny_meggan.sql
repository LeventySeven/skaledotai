ALTER TABLE "internal_leads" ADD COLUMN "bio" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "internal_leads" ADD COLUMN "tags" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "internal_leads" ADD COLUMN "relevancy" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "internal_leads" ADD COLUMN "source_lead_id" uuid;--> statement-breakpoint
ALTER TABLE "internal_leads" ADD COLUMN "last_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "internal_leads" ADD CONSTRAINT "internal_leads_source_lead_id_leads_id_fk" FOREIGN KEY ("source_lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "internal_leads_user_handle_platform_idx" ON "internal_leads" USING btree ("user_id","handle","platform");
