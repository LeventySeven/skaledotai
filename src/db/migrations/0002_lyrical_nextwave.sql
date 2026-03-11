ALTER TABLE "project_runs" ADD COLUMN "request_key" text;--> statement-breakpoint
UPDATE "project_runs"
SET "request_key" = concat_ws(
  '::',
  "project_id"::text,
  "operation_type",
  "requested_provider",
  coalesce(lower(trim("query")), ''),
  coalesce(lower(trim("seed_username")), '')
);--> statement-breakpoint
ALTER TABLE "project_runs" ALTER COLUMN "request_key" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "project_runs_request_key_idx" ON "project_runs" USING btree ("request_key");
