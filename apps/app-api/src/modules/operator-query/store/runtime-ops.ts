import { and, desc, eq, lt, or, type SQL } from "drizzle-orm";

import {
	temporalTaskQueueCurrent,
	workerAutoscalerActuation,
	workerAutoscalerDecisionCurrent,
	workerAutoscalerPosture,
} from "../../../db/schema";
import type {
	NormalizedTemporalTaskQueueListFilters,
	NormalizedWorkerAutoscalerActuationListFilters,
	NormalizedWorkerAutoscalerDecisionListFilters,
	NormalizedWorkerAutoscalerPostureListFilters,
	TemporalTaskQueueListResult,
	TemporalTaskQueueSnapshotRecord,
	WorkerAutoscalerActuationListResult,
	WorkerAutoscalerActuationRecord,
	WorkerAutoscalerDecisionListResult,
	WorkerAutoscalerDecisionRecord,
	WorkerAutoscalerPostureListResult,
	WorkerAutoscalerPostureRecord,
} from "../service";
import { decodeRuntimeProjectionCursor, encodeRuntimeProjectionCursor } from "./cursors";
import type {
	OperatorQueryRuntime,
	TemporalTaskQueueCurrentRow,
	WorkerAutoscalerActuationRow,
	WorkerAutoscalerDecisionCurrentRow,
	WorkerAutoscalerPostureRow,
} from "./runtime";

function toTemporalTaskQueueSnapshotRecord(
	row: TemporalTaskQueueCurrentRow,
): TemporalTaskQueueSnapshotRecord {
	return {
		backlog: row.backlogJson,
		namespace: row.namespace,
		oldestTaskAge: row.oldestTaskAgeJson,
		pollerCount: row.pollerCount,
		pollerIdentities: row.pollerIdentitiesJson,
		projectedAt: row.projectedAt.toISOString(),
		sampledAt: row.sampledAt.toISOString(),
		scheduleToStartLatency: row.scheduleToStartLatencyJson,
		snapshotId: row.snapshotId,
		source: row.source,
		taskQueue: row.taskQueue,
		taskQueueKind: row.taskQueueKind,
	};
}

function toWorkerAutoscalerDecisionRecord(
	row: WorkerAutoscalerDecisionCurrentRow,
): WorkerAutoscalerDecisionRecord {
	return {
		budgetState: row.budgetState,
		currentReplicas: row.currentReplicas,
		decidedAt: row.decidedAt.toISOString(),
		decision: row.decision,
		decisionId: row.decisionId,
		desiredReplicas: row.desiredReplicas,
		projectedAt: row.projectedAt.toISOString(),
		reason: row.reason,
		sourceSnapshotId: row.sourceSnapshotId,
		targetService: row.targetService,
		taskQueue: row.taskQueue,
		taskQueueKind: row.taskQueueKind,
	};
}

function toWorkerAutoscalerActuationRecord(
	row: WorkerAutoscalerActuationRow,
): WorkerAutoscalerActuationRecord {
	return {
		actedAt: row.actedAt.toISOString(),
		action: row.action,
		actuationId: row.actuationId,
		actuatorKind: row.actuatorKind,
		decisionId: row.decisionId,
		errorCode: row.errorCode ?? null,
		fromReplicas: row.fromReplicas,
		projectedAt: row.projectedAt.toISOString(),
		status: row.status as WorkerAutoscalerActuationRecord["status"],
		targetService: row.targetService,
		toReplicas: row.toReplicas,
	};
}

function toWorkerAutoscalerPostureRecord(
	row: WorkerAutoscalerPostureRow,
): WorkerAutoscalerPostureRecord {
	return {
		currentReplicas: row.currentReplicas,
		desiredReplicas: row.desiredReplicas,
		evidence: row.evidenceJson,
		lastScaleEventAt: row.lastScaleEventAt?.toISOString() ?? null,
		lastScaleEventId: row.lastScaleEventId ?? null,
		maxReplicas: row.maxReplicas,
		metricFreshness: row.metricFreshnessJson,
		minReplicas: row.minReplicas,
		observedAt: row.observedAt.toISOString(),
		projectedAt: row.projectedAt.toISOString(),
		reason: row.reason,
		scalerKind: row.scalerKind,
		scalerStatus: row.scalerStatus,
		targetService: row.targetService,
		taskQueue: row.taskQueue,
		taskQueueKind: row.taskQueueKind,
	};
}

export function createRuntimeOpsStoreHandlers(runtime: OperatorQueryRuntime) {
	return {
		async listTemporalTaskQueues(
			filters: NormalizedTemporalTaskQueueListFilters,
		): Promise<TemporalTaskQueueListResult> {
			const db = await runtime.getDb();
			const conditions: SQL[] = [];
			if (filters.taskQueue) {
				conditions.push(eq(temporalTaskQueueCurrent.taskQueue, filters.taskQueue));
			}
			if (filters.taskQueueKind) {
				conditions.push(eq(temporalTaskQueueCurrent.taskQueueKind, filters.taskQueueKind));
			}
			const cursor = filters.cursor ? decodeRuntimeProjectionCursor(filters.cursor) : null;
			if (cursor) {
				const cursorSampledAt = new Date(cursor.timestamp);
				const cursorCondition = or(
					lt(temporalTaskQueueCurrent.sampledAt, cursorSampledAt),
					and(
						eq(temporalTaskQueueCurrent.sampledAt, cursorSampledAt),
						lt(temporalTaskQueueCurrent.currentId, cursor.id),
					),
				);
				if (cursorCondition) {
					conditions.push(cursorCondition);
				}
			}

			const rows = await (conditions.length > 0
				? db
						.select()
						.from(temporalTaskQueueCurrent)
						.where(and(...conditions))
				: db.select().from(temporalTaskQueueCurrent)
			)
				.orderBy(desc(temporalTaskQueueCurrent.sampledAt), desc(temporalTaskQueueCurrent.currentId))
				.limit(filters.limit + 1);
			const visibleRows = rows.slice(0, filters.limit);
			const cursorRow = rows.length > filters.limit ? visibleRows.at(-1) : null;
			return {
				page: {
					nextCursor: cursorRow
						? encodeRuntimeProjectionCursor({
								id: cursorRow.currentId,
								timestamp: cursorRow.sampledAt.toISOString(),
							})
						: null,
				},
				snapshots: visibleRows.map(toTemporalTaskQueueSnapshotRecord),
			};
		},

		async listAutoscalerDecisions(
			filters: NormalizedWorkerAutoscalerDecisionListFilters,
		): Promise<WorkerAutoscalerDecisionListResult> {
			const db = await runtime.getDb();
			const conditions: SQL[] = [];
			if (filters.targetService) {
				conditions.push(eq(workerAutoscalerDecisionCurrent.targetService, filters.targetService));
			}
			if (filters.decision) {
				conditions.push(eq(workerAutoscalerDecisionCurrent.decision, filters.decision));
			}
			const cursor = filters.cursor ? decodeRuntimeProjectionCursor(filters.cursor) : null;
			if (cursor) {
				const cursorDecidedAt = new Date(cursor.timestamp);
				const cursorCondition = or(
					lt(workerAutoscalerDecisionCurrent.decidedAt, cursorDecidedAt),
					and(
						eq(workerAutoscalerDecisionCurrent.decidedAt, cursorDecidedAt),
						lt(workerAutoscalerDecisionCurrent.currentId, cursor.id),
					),
				);
				if (cursorCondition) {
					conditions.push(cursorCondition);
				}
			}

			const rows = await (conditions.length > 0
				? db
						.select()
						.from(workerAutoscalerDecisionCurrent)
						.where(and(...conditions))
				: db.select().from(workerAutoscalerDecisionCurrent)
			)
				.orderBy(
					desc(workerAutoscalerDecisionCurrent.decidedAt),
					desc(workerAutoscalerDecisionCurrent.currentId),
				)
				.limit(filters.limit + 1);
			const visibleRows = rows.slice(0, filters.limit);
			const cursorRow = rows.length > filters.limit ? visibleRows.at(-1) : null;
			return {
				decisions: visibleRows.map(toWorkerAutoscalerDecisionRecord),
				page: {
					nextCursor: cursorRow
						? encodeRuntimeProjectionCursor({
								id: cursorRow.currentId,
								timestamp: cursorRow.decidedAt.toISOString(),
							})
						: null,
				},
			};
		},

		async listAutoscalerActuations(
			filters: NormalizedWorkerAutoscalerActuationListFilters,
		): Promise<WorkerAutoscalerActuationListResult> {
			const db = await runtime.getDb();
			const conditions: SQL[] = [];
			if (filters.targetService) {
				conditions.push(eq(workerAutoscalerActuation.targetService, filters.targetService));
			}
			if (filters.status) {
				conditions.push(eq(workerAutoscalerActuation.status, filters.status));
			}
			if (filters.decisionId) {
				conditions.push(eq(workerAutoscalerActuation.decisionId, filters.decisionId));
			}
			const cursor = filters.cursor ? decodeRuntimeProjectionCursor(filters.cursor) : null;
			if (cursor) {
				const cursorActedAt = new Date(cursor.timestamp);
				const cursorCondition = or(
					lt(workerAutoscalerActuation.actedAt, cursorActedAt),
					and(
						eq(workerAutoscalerActuation.actedAt, cursorActedAt),
						lt(workerAutoscalerActuation.actuationId, cursor.id),
					),
				);
				if (cursorCondition) {
					conditions.push(cursorCondition);
				}
			}

			const rows = await (conditions.length > 0
				? db
						.select()
						.from(workerAutoscalerActuation)
						.where(and(...conditions))
				: db.select().from(workerAutoscalerActuation)
			)
				.orderBy(
					desc(workerAutoscalerActuation.actedAt),
					desc(workerAutoscalerActuation.actuationId),
				)
				.limit(filters.limit + 1);
			const visibleRows = rows.slice(0, filters.limit);
			const cursorRow = rows.length > filters.limit ? visibleRows.at(-1) : null;
			return {
				actuations: visibleRows.map(toWorkerAutoscalerActuationRecord),
				page: {
					nextCursor: cursorRow
						? encodeRuntimeProjectionCursor({
								id: cursorRow.actuationId,
								timestamp: cursorRow.actedAt.toISOString(),
							})
						: null,
				},
			};
		},

		async listAutoscalerPostures(
			filters: NormalizedWorkerAutoscalerPostureListFilters,
		): Promise<WorkerAutoscalerPostureListResult> {
			const db = await runtime.getDb();
			const conditions: SQL[] = [];
			if (filters.targetService) {
				conditions.push(eq(workerAutoscalerPosture.targetService, filters.targetService));
			}
			if (filters.scalerStatus) {
				conditions.push(eq(workerAutoscalerPosture.scalerStatus, filters.scalerStatus));
			}
			const cursor = filters.cursor ? decodeRuntimeProjectionCursor(filters.cursor) : null;
			if (cursor) {
				const cursorObservedAt = new Date(cursor.timestamp);
				const cursorCondition = or(
					lt(workerAutoscalerPosture.observedAt, cursorObservedAt),
					and(
						eq(workerAutoscalerPosture.observedAt, cursorObservedAt),
						lt(workerAutoscalerPosture.postureId, cursor.id),
					),
				);
				if (cursorCondition) {
					conditions.push(cursorCondition);
				}
			}

			const rows = await (conditions.length > 0
				? db
						.select()
						.from(workerAutoscalerPosture)
						.where(and(...conditions))
				: db.select().from(workerAutoscalerPosture)
			)
				.orderBy(desc(workerAutoscalerPosture.observedAt), desc(workerAutoscalerPosture.postureId))
				.limit(filters.limit + 1);
			const visibleRows = rows.slice(0, filters.limit);
			const cursorRow = rows.length > filters.limit ? visibleRows.at(-1) : null;
			return {
				page: {
					nextCursor: cursorRow
						? encodeRuntimeProjectionCursor({
								id: cursorRow.postureId,
								timestamp: cursorRow.observedAt.toISOString(),
							})
						: null,
				},
				postures: visibleRows.map(toWorkerAutoscalerPostureRecord),
			};
		},
	};
}
