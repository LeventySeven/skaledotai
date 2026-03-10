CREATE TABLE "project_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"operation_type" text NOT NULL,
	"requested_provider" text NOT NULL,
	"discovery_provider" text NOT NULL,
	"lookup_provider" text NOT NULL,
	"network_provider" text NOT NULL,
	"tweets_provider" text NOT NULL,
	"query" text,
	"seed_username" text,
	"lead_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_runs" ADD CONSTRAINT "project_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_runs_project_id_idx" ON "project_runs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_runs_requested_provider_idx" ON "project_runs" USING btree ("requested_provider");