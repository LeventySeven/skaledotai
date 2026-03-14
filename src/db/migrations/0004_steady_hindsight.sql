ALTER TABLE "leads" ADD COLUMN "location" text;

CREATE TABLE "project_lead_insights" (
  "project_id" uuid NOT NULL,
  "lead_id" uuid NOT NULL,
  "context_hash" text NOT NULL,
  "summary" text NOT NULL,
  "alignment_bullets" text[] DEFAULT '{}'::text[] NOT NULL,
  "user_goals" text[] DEFAULT '{}'::text[] NOT NULL,
  "confidence" integer DEFAULT 0 NOT NULL,
  "tools" text[] DEFAULT '{}'::text[] NOT NULL,
  "subagents" text[] DEFAULT '{}'::text[] NOT NULL,
  "generated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "project_lead_insights_project_id_lead_id_pk" PRIMARY KEY("project_id","lead_id")
);
--> statement-breakpoint
ALTER TABLE "project_lead_insights" ADD CONSTRAINT "project_lead_insights_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_lead_insights" ADD CONSTRAINT "project_lead_insights_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "project_lead_insights_project_id_idx" ON "project_lead_insights" USING btree ("project_id");
--> statement-breakpoint
CREATE INDEX "project_lead_insights_lead_id_idx" ON "project_lead_insights" USING btree ("lead_id");
