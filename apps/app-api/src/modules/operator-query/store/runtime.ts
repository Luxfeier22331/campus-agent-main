import type { createRuntimeDatabase } from "../../../db/runtime";
import type {
	messageFeedback,
	metricRollup,
	qualityGradeProjection,
	requestObservabilityFact,
	temporalTaskQueueCurrent,
	temporalTaskQueueSnapshot,
	traceBacklinkProjection,
	workerAutoscalerActuation,
	workerAutoscalerDecision,
	workerAutoscalerDecisionCurrent,
} from "../../../db/schema";

export type RequestObservabilityFactRow = typeof requestObservabilityFact.$inferSelect;
export type MessageFeedbackRow = typeof messageFeedback.$inferSelect;
export type MetricRollupRow = typeof metricRollup.$inferSelect;
export type QualityGradeProjectionRow = typeof qualityGradeProjection.$inferSelect;
export type TraceBacklinkProjectionRow = typeof traceBacklinkProjection.$inferSelect;
export type TemporalTaskQueueCurrentRow = typeof temporalTaskQueueCurrent.$inferSelect;
export type TemporalTaskQueueSnapshotRow = typeof temporalTaskQueueSnapshot.$inferSelect;
export type WorkerAutoscalerDecisionCurrentRow =
	typeof workerAutoscalerDecisionCurrent.$inferSelect;
export type WorkerAutoscalerDecisionRow = typeof workerAutoscalerDecision.$inferSelect;
export type WorkerAutoscalerActuationRow = typeof workerAutoscalerActuation.$inferSelect;
export type RuntimeDatabase = Awaited<ReturnType<typeof createRuntimeDatabase>>;
export type RuntimeDbGetter = () => ReturnType<typeof createRuntimeDatabase>;

export interface OperatorQueryRuntime {
	getDb: RuntimeDbGetter;
	now: () => Date;
}
