CREATE TABLE "operator"."eval_coverage_snapshot" (
    "snapshot_id" text PRIMARY KEY NOT NULL,
    "schema_version" text NOT NULL,
    "generated_at" timestamp with time zone NOT NULL,
    "source_git_head" text NOT NULL,
    "payload_json" jsonb NOT NULL,
    "created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "operator_eval_coverage_snapshot_generated_at_idx"
ON "operator"."eval_coverage_snapshot" USING btree ("generated_at");
