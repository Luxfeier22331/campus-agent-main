CREATE TABLE "operator"."worker_autoscaler_posture" (
	"posture_id" text PRIMARY KEY NOT NULL,
	"target_service" text NOT NULL,
	"task_queue" text NOT NULL,
	"task_queue_kind" text NOT NULL,
	"scaler_kind" text NOT NULL,
	"scaler_status" text NOT NULL,
	"metric_freshness_json" jsonb NOT NULL,
	"current_replicas" integer NOT NULL,
	"desired_replicas" integer NOT NULL,
	"min_replicas" integer NOT NULL,
	"max_replicas" integer NOT NULL,
	"last_scale_event_id" text,
	"last_scale_event_at" timestamp with time zone,
	"reason" text NOT NULL,
	"evidence_json" jsonb NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"projected_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "operator_worker_autoscaler_posture_target_observed_idx" ON "operator"."worker_autoscaler_posture" USING btree ("target_service","observed_at");--> statement-breakpoint
CREATE INDEX "operator_worker_autoscaler_posture_status_observed_idx" ON "operator"."worker_autoscaler_posture" USING btree ("scaler_status","observed_at");