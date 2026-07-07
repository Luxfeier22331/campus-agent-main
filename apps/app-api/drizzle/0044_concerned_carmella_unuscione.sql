CREATE TABLE "operator"."temporal_task_queue_snapshot" (
	"snapshot_id" text PRIMARY KEY NOT NULL,
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
CREATE TABLE "operator"."worker_autoscaler_actuation" (
	"actuation_id" text PRIMARY KEY NOT NULL,
	"decision_id" text NOT NULL,
	"target_service" text NOT NULL,
	"actuator_kind" text NOT NULL,
	"action" text NOT NULL,
	"status" text NOT NULL,
	"from_replicas" integer NOT NULL,
	"to_replicas" integer NOT NULL,
	"error_code" text,
	"acted_at" timestamp with time zone NOT NULL,
	"projected_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator"."worker_autoscaler_decision" (
	"decision_id" text PRIMARY KEY NOT NULL,
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
CREATE INDEX "operator_temporal_tq_snapshot_queue_sampled_idx" ON "operator"."temporal_task_queue_snapshot" USING btree ("task_queue","sampled_at");--> statement-breakpoint
CREATE INDEX "operator_temporal_tq_snapshot_kind_sampled_idx" ON "operator"."temporal_task_queue_snapshot" USING btree ("task_queue_kind","sampled_at");--> statement-breakpoint
CREATE INDEX "operator_worker_autoscaler_actuation_decision_idx" ON "operator"."worker_autoscaler_actuation" USING btree ("decision_id","acted_at");--> statement-breakpoint
CREATE INDEX "operator_worker_autoscaler_actuation_target_idx" ON "operator"."worker_autoscaler_actuation" USING btree ("target_service","acted_at");--> statement-breakpoint
CREATE INDEX "operator_worker_autoscaler_target_decided_idx" ON "operator"."worker_autoscaler_decision" USING btree ("target_service","decided_at");--> statement-breakpoint
CREATE INDEX "operator_worker_autoscaler_decision_decided_idx" ON "operator"."worker_autoscaler_decision" USING btree ("decision","decided_at");--> statement-breakpoint
CREATE INDEX "operator_worker_autoscaler_snapshot_idx" ON "operator"."worker_autoscaler_decision" USING btree ("source_snapshot_id");