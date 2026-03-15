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
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "internal_leads" ADD CONSTRAINT "internal_leads_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "internal_leads_user_id_idx" ON "internal_leads" USING btree ("user_id");