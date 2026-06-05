ALTER TABLE "runtime"."request_execution"
ADD COLUMN "run_id" text;
--> statement-breakpoint
CREATE INDEX "runtime_request_execution_run_started_at_idx"
ON "runtime"."request_execution" USING btree ("run_id", "started_at");
