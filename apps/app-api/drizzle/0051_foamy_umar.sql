CREATE TABLE "operator"."temporal_task_queue_current" (
	"current_id" text PRIMARY KEY NOT NULL,
	"snapshot_id" text NOT NULL,
	"namespace" text NOT NULL,
	"task_queue" text NOT NULL,
	"task_queue_kind" text NOT NULL,
	"source" text NOT NULL,
	"poller_count" integer NOT NULL,
	"poller_identities_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"backlog_json" jsonb NOT NULL,
	"oldest_task_age_json" jsonb NOT NULL,
	"schedule_to_start_latency_json" jsonb NOT NULL,
	"sampled_at" timestamp with time zone NOT NULL,
	"projected_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator"."worker_autoscaler_decision_current" (
	"current_id" text PRIMARY KEY NOT NULL,
	"decision_id" text NOT NULL,
	"task_queue" text NOT NULL,
	"task_queue_kind" text NOT NULL,
	"target_service" text NOT NULL,
	"decision" text NOT NULL,
	"current_replicas" integer NOT NULL,
	"desired_replicas" integer NOT NULL,
	"budget_state" text NOT NULL,
	"reason" text NOT NULL,
	"source_snapshot_id" text NOT NULL,
	"evidence_json" jsonb NOT NULL,
	"decided_at" timestamp with time zone NOT NULL,
	"projected_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "operator_temporal_tq_current_queue_sampled_idx" ON "operator"."temporal_task_queue_current" USING btree ("task_queue","sampled_at");--> statement-breakpoint
CREATE INDEX "operator_temporal_tq_current_kind_sampled_idx" ON "operator"."temporal_task_queue_current" USING btree ("task_queue_kind","sampled_at");--> statement-breakpoint
CREATE INDEX "operator_worker_autoscaler_current_target_idx" ON "operator"."worker_autoscaler_decision_current" USING btree ("target_service","decided_at");--> statement-breakpoint
CREATE INDEX "operator_worker_autoscaler_current_decision_idx" ON "operator"."worker_autoscaler_decision_current" USING btree ("decision","decided_at");