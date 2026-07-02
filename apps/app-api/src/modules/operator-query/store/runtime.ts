import type { createRuntimeDatabase } from "../../../db/runtime";
import type {
	requestObservabilityFact,
	temporalTaskQueueCurrent,
	temporalTaskQueueSnapshot,
	workerAutoscalerActuation,
	workerAutoscalerDecision,
	workerAutoscalerDecisionCurrent,
	workerAutoscalerPosture,
} from "../../../db/schema";

export type RequestObservabilityFactRow = typeof requestObservabilityFact.$inferSelect;
export type TemporalTaskQueueCurrentRow = typeof temporalTaskQueueCurrent.$inferSelect;
export type TemporalTaskQueueSnapshotRow = typeof temporalTaskQueueSnapshot.$inferSelect;
export type WorkerAutoscalerDecisionCurrentRow =
	typeof workerAutoscalerDecisionCurrent.$inferSelect;
export type WorkerAutoscalerDecisionRow = typeof workerAutoscalerDecision.$inferSelect;
export type WorkerAutoscalerActuationRow = typeof workerAutoscalerActuation.$inferSelect;
export type WorkerAutoscalerPostureRow = typeof workerAutoscalerPosture.$inferSelect;
export type RuntimeDatabase = Awaited<ReturnType<typeof createRuntimeDatabase>>;
export type RuntimeDbGetter = () => ReturnType<typeof createRuntimeDatabase>;

export interface OperatorQueryRuntime {
	getDb: RuntimeDbGetter;
	now: () => Date;
}
