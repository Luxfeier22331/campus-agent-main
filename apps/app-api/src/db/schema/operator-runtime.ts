import { index, integer, jsonb, pgSchema, text, timestamp } from "drizzle-orm/pg-core";
import type {
	CountSourceMetric,
	DurationSourceMetric,
	TemporalTaskQueueKind,
	WorkerAutoscalerDecisionWrite,
	WorkerAutoscalerPostureWrite,
} from "../../modules/operator-runtime-observability";

const operator = pgSchema("operator");

export const temporalTaskQueueSnapshot = operator.table(
	"temporal_task_queue_snapshot",
	{
		snapshotId: text("snapshot_id").primaryKey(),
		namespace: text("namespace").notNull(),
		taskQueue: text("task_queue").notNull(),
		taskQueueKind: text("task_queue_kind").$type<TemporalTaskQueueKind>().notNull(),
		source: text("source").notNull(),
		pollerCount: integer("poller_count").notNull(),
		pollerIdentitiesJson: jsonb("poller_identities_json").$type<string[]>().notNull().default([]),
		backlogJson: jsonb("backlog_json").$type<CountSourceMetric>().notNull(),
		oldestTaskAgeJson: jsonb("oldest_task_age_json").$type<DurationSourceMetric>().notNull(),
		scheduleToStartLatencyJson: jsonb("schedule_to_start_latency_json")
			.$type<DurationSourceMetric>()
			.notNull(),
		sampledAt: timestamp("sampled_at", { withTimezone: true }).notNull(),
		projectedAt: timestamp("projected_at", { withTimezone: true }).notNull(),
	},
	(table) => ({
		taskQueueSampledAtIndex: index("operator_temporal_tq_snapshot_queue_sampled_idx").on(
			table.taskQueue,
			table.sampledAt,
		),
		taskQueueKindSampledAtIndex: index("operator_temporal_tq_snapshot_kind_sampled_idx").on(
			table.taskQueueKind,
			table.sampledAt,
		),
	}),
);

export const temporalTaskQueueCurrent = operator.table(
	"temporal_task_queue_current",
	{
		currentId: text("current_id").primaryKey(),
		snapshotId: text("snapshot_id").notNull(),
		namespace: text("namespace").notNull(),
		taskQueue: text("task_queue").notNull(),
		taskQueueKind: text("task_queue_kind").$type<TemporalTaskQueueKind>().notNull(),
		source: text("source").notNull(),
		pollerCount: integer("poller_count").notNull(),
		pollerIdentitiesJson: jsonb("poller_identities_json").$type<string[]>().notNull().default([]),
		backlogJson: jsonb("backlog_json").$type<CountSourceMetric>().notNull(),
		oldestTaskAgeJson: jsonb("oldest_task_age_json").$type<DurationSourceMetric>().notNull(),
		scheduleToStartLatencyJson: jsonb("schedule_to_start_latency_json")
			.$type<DurationSourceMetric>()
			.notNull(),
		sampledAt: timestamp("sampled_at", { withTimezone: true }).notNull(),
		projectedAt: timestamp("projected_at", { withTimezone: true }).notNull(),
	},
	(table) => ({
		taskQueueSampledAtIndex: index("operator_temporal_tq_current_queue_sampled_idx").on(
			table.taskQueue,
			table.sampledAt,
		),
		taskQueueKindSampledAtIndex: index("operator_temporal_tq_current_kind_sampled_idx").on(
			table.taskQueueKind,
			table.sampledAt,
		),
	}),
);

export const workerAutoscalerDecision = operator.table(
	"worker_autoscaler_decision",
	{
		decisionId: text("decision_id").primaryKey(),
		taskQueue: text("task_queue").notNull(),
		taskQueueKind: text("task_queue_kind").$type<TemporalTaskQueueKind>().notNull(),
		targetService: text("target_service").notNull(),
		decision: text("decision").$type<WorkerAutoscalerDecisionWrite["decision"]>().notNull(),
		currentReplicas: integer("current_replicas").notNull(),
		desiredReplicas: integer("desired_replicas").notNull(),
		budgetState: text("budget_state")
			.$type<WorkerAutoscalerDecisionWrite["budgetState"]>()
			.notNull(),
		reason: text("reason").notNull(),
		sourceSnapshotId: text("source_snapshot_id").notNull(),
		evidenceJson: jsonb("evidence_json").$type<Record<string, unknown>>().notNull(),
		decidedAt: timestamp("decided_at", { withTimezone: true }).notNull(),
		projectedAt: timestamp("projected_at", { withTimezone: true }).notNull(),
	},
	(table) => ({
		targetServiceDecidedAtIndex: index("operator_worker_autoscaler_target_decided_idx").on(
			table.targetService,
			table.decidedAt,
		),
		decisionDecidedAtIndex: index("operator_worker_autoscaler_decision_decided_idx").on(
			table.decision,
			table.decidedAt,
		),
		sourceSnapshotIndex: index("operator_worker_autoscaler_snapshot_idx").on(
			table.sourceSnapshotId,
		),
	}),
);

export const workerAutoscalerDecisionCurrent = operator.table(
	"worker_autoscaler_decision_current",
	{
		currentId: text("current_id").primaryKey(),
		decisionId: text("decision_id").notNull(),
		taskQueue: text("task_queue").notNull(),
		taskQueueKind: text("task_queue_kind").$type<TemporalTaskQueueKind>().notNull(),
		targetService: text("target_service").notNull(),
		decision: text("decision").$type<WorkerAutoscalerDecisionWrite["decision"]>().notNull(),
		currentReplicas: integer("current_replicas").notNull(),
		desiredReplicas: integer("desired_replicas").notNull(),
		budgetState: text("budget_state")
			.$type<WorkerAutoscalerDecisionWrite["budgetState"]>()
			.notNull(),
		reason: text("reason").notNull(),
		sourceSnapshotId: text("source_snapshot_id").notNull(),
		evidenceJson: jsonb("evidence_json").$type<Record<string, unknown>>().notNull(),
		decidedAt: timestamp("decided_at", { withTimezone: true }).notNull(),
		projectedAt: timestamp("projected_at", { withTimezone: true }).notNull(),
	},
	(table) => ({
		targetServiceDecidedAtIndex: index("operator_worker_autoscaler_current_target_idx").on(
			table.targetService,
			table.decidedAt,
		),
		decisionDecidedAtIndex: index("operator_worker_autoscaler_current_decision_idx").on(
			table.decision,
			table.decidedAt,
		),
	}),
);

export const workerAutoscalerActuation = operator.table(
	"worker_autoscaler_actuation",
	{
		actuationId: text("actuation_id").primaryKey(),
		decisionId: text("decision_id").notNull(),
		targetService: text("target_service").notNull(),
		actuatorKind: text("actuator_kind").notNull(),
		action: text("action").notNull(),
		status: text("status").notNull(),
		fromReplicas: integer("from_replicas").notNull(),
		toReplicas: integer("to_replicas").notNull(),
		errorCode: text("error_code"),
		actedAt: timestamp("acted_at", { withTimezone: true }).notNull(),
		projectedAt: timestamp("projected_at", { withTimezone: true }).notNull(),
	},
	(table) => ({
		decisionActedAtIndex: index("operator_worker_autoscaler_actuation_decision_idx").on(
			table.decisionId,
			table.actedAt,
		),
		targetServiceActedAtIndex: index("operator_worker_autoscaler_actuation_target_idx").on(
			table.targetService,
			table.actedAt,
		),
	}),
);

export const workerAutoscalerPosture = operator.table(
	"worker_autoscaler_posture",
	{
		postureId: text("posture_id").primaryKey(),
		targetService: text("target_service").notNull(),
		taskQueue: text("task_queue").notNull(),
		taskQueueKind: text("task_queue_kind").$type<TemporalTaskQueueKind>().notNull(),
		scalerKind: text("scaler_kind").$type<WorkerAutoscalerPostureWrite["scalerKind"]>().notNull(),
		scalerStatus: text("scaler_status")
			.$type<WorkerAutoscalerPostureWrite["scalerStatus"]>()
			.notNull(),
		metricFreshnessJson: jsonb("metric_freshness_json").$type<DurationSourceMetric>().notNull(),
		currentReplicas: integer("current_replicas").notNull(),
		desiredReplicas: integer("desired_replicas").notNull(),
		minReplicas: integer("min_replicas").notNull(),
		maxReplicas: integer("max_replicas").notNull(),
		lastScaleEventId: text("last_scale_event_id"),
		lastScaleEventAt: timestamp("last_scale_event_at", { withTimezone: true }),
		reason: text("reason").notNull(),
		evidenceJson: jsonb("evidence_json").$type<Record<string, unknown>>().notNull(),
		observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
		projectedAt: timestamp("projected_at", { withTimezone: true }).notNull(),
	},
	(table) => ({
		targetObservedAtIndex: index("operator_worker_autoscaler_posture_target_observed_idx").on(
			table.targetService,
			table.observedAt,
		),
		statusObservedAtIndex: index("operator_worker_autoscaler_posture_status_observed_idx").on(
			table.scalerStatus,
			table.observedAt,
		),
	}),
);
