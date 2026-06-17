import { AppApiRouteError } from "../../http";
import type {
	AutoscalerActuationStatus,
	AutoscalerBudgetState,
	AutoscalerDecisionKind,
	CountSourceMetric,
	DurationSourceMetric,
	TemporalTaskQueueKind,
	TemporalTaskQueueSnapshotWrite,
	WorkerAutoscalerActuationWrite,
	WorkerAutoscalerDecisionWrite,
} from "./types";

const SCHEMA_VERSION = "temporal_task_queue_metrics_snapshot.v1";
const TASK_QUEUE_KINDS = new Set(["workflow", "activity"]);
const METRIC_STATES = new Set(["observed", "unsupported_by_source"]);
const DECISIONS = new Set(["scale_up", "scale_down", "hold"]);
const BUDGET_STATES = new Set(["within_budget", "budget_exhausted", "actuation_disabled"]);
const ACTUATION_STATUSES = new Set(["applied", "skipped", "failed"]);
const FORBIDDEN_RUNTIME_KEYS = new Set([
	"authorization",
	"cookie",
	"credentials",
	"jwt",
	"raw",
	"rawtemporalresponse",
	"raw_response",
	"token",
]);

export interface TemporalTaskQueueRuntimePayload {
	actuations?: unknown;
	decisions?: unknown;
	schemaVersion?: unknown;
	snapshots?: unknown;
}

export interface NormalizedTemporalTaskQueueRuntimePayload {
	actuations: WorkerAutoscalerActuationWrite[];
	decisions: WorkerAutoscalerDecisionWrite[];
	snapshots: TemporalTaskQueueSnapshotWrite[];
}

function validationError(field: string, message: string): AppApiRouteError {
	return new AppApiRouteError({
		code: "validation_failed",
		details: { field },
		message,
		retryable: false,
		status: 422,
	});
}

function normalizeKey(value: string): string {
	return value.replaceAll(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function findForbiddenKey(value: unknown, path = "$"): string | null {
	if (!value || typeof value !== "object") {
		return null;
	}
	if (Array.isArray(value)) {
		for (let index = 0; index < value.length; index += 1) {
			const found = findForbiddenKey(value[index], `${path}[${index}]`);
			if (found) {
				return found;
			}
		}
		return null;
	}
	for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
		if (FORBIDDEN_RUNTIME_KEYS.has(normalizeKey(key))) {
			return `${path}.${key}`;
		}
		const found = findForbiddenKey(nested, `${path}.${key}`);
		if (found) {
			return found;
		}
	}
	return null;
}

export function assertNoForbiddenTemporalRuntimeFields(value: unknown): void {
	const field = findForbiddenKey(value);
	if (field) {
		throw validationError(field, `${field} is forbidden in runtime observability payloads.`);
	}
}

function normalizeRecord(value: unknown, field: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw validationError(field, `${field} must be an object.`);
	}
	return value as Record<string, unknown>;
}

function normalizeArray(value: unknown, field: string): unknown[] {
	if (value === null || value === undefined) {
		return [];
	}
	if (!Array.isArray(value)) {
		throw validationError(field, `${field} must be an array.`);
	}
	return value;
}

function normalizeRequiredString(value: unknown, field: string): string {
	const normalized = typeof value === "string" ? value.trim() : "";
	if (!normalized) {
		throw validationError(field, `${field} is required.`);
	}
	return normalized;
}

function normalizeNullableString(value: unknown): string | null {
	const normalized = typeof value === "string" ? value.trim() : "";
	return normalized || null;
}

function normalizeIsoTimestamp(value: unknown, field: string): string {
	const normalized = normalizeRequiredString(value, field);
	const timestamp = new Date(normalized);
	if (Number.isNaN(timestamp.valueOf())) {
		throw validationError(field, `${field} must be a valid ISO timestamp.`);
	}
	return timestamp.toISOString();
}

function normalizeNonNegativeInteger(value: unknown, field: string): number {
	if (
		typeof value === "number" &&
		Number.isInteger(value) &&
		Number.isFinite(value) &&
		value >= 0
	) {
		return value;
	}
	throw validationError(field, `${field} must be a non-negative integer.`);
}

function normalizeTaskQueueKind(value: unknown, field: string): TemporalTaskQueueKind {
	const normalized = normalizeRequiredString(value, field);
	if (!TASK_QUEUE_KINDS.has(normalized)) {
		throw validationError(field, `${field} must be workflow or activity.`);
	}
	return normalized as TemporalTaskQueueKind;
}

function normalizeDecision(value: unknown, field: string): AutoscalerDecisionKind {
	const normalized = normalizeRequiredString(value, field);
	if (!DECISIONS.has(normalized)) {
		throw validationError(field, `${field} must be scale_up, scale_down, or hold.`);
	}
	return normalized as AutoscalerDecisionKind;
}

function normalizeBudgetState(value: unknown, field: string): AutoscalerBudgetState {
	const normalized = normalizeRequiredString(value, field);
	if (!BUDGET_STATES.has(normalized)) {
		throw validationError(
			field,
			`${field} must be within_budget, budget_exhausted, or actuation_disabled.`,
		);
	}
	return normalized as AutoscalerBudgetState;
}

function normalizeActuationStatus(value: unknown, field: string): AutoscalerActuationStatus {
	const normalized = normalizeRequiredString(value, field);
	if (!ACTUATION_STATUSES.has(normalized)) {
		throw validationError(field, `${field} must be applied, skipped, or failed.`);
	}
	return normalized as AutoscalerActuationStatus;
}

function normalizeStringArray(value: unknown, field: string): string[] {
	if (!Array.isArray(value)) {
		throw validationError(field, `${field} must be an array.`);
	}
	return value.map((item, index) => normalizeRequiredString(item, `${field}[${index}]`));
}

function normalizeRecordCopy(value: unknown, field: string): Record<string, unknown> {
	return { ...normalizeRecord(value, field) };
}

function normalizeCountMetric(value: unknown, field: string): CountSourceMetric {
	const record = normalizeRecord(value, field);
	const state = normalizeRequiredString(record.state, `${field}.state`);
	if (!METRIC_STATES.has(state)) {
		throw validationError(field, `${field}.state must be observed or unsupported_by_source.`);
	}
	if (state === "unsupported_by_source") {
		return { count: null, state };
	}
	return {
		count: normalizeNonNegativeInteger(record.count, `${field}.count`),
		state: "observed",
	};
}

function normalizeDurationMetric(value: unknown, field: string): DurationSourceMetric {
	const record = normalizeRecord(value, field);
	const state = normalizeRequiredString(record.state, `${field}.state`);
	if (!METRIC_STATES.has(state)) {
		throw validationError(field, `${field}.state must be observed or unsupported_by_source.`);
	}
	if (state === "unsupported_by_source") {
		return { ms: null, state };
	}
	return {
		ms: normalizeNonNegativeInteger(record.ms, `${field}.ms`),
		state: "observed",
	};
}

function normalizeSnapshot(
	value: unknown,
	index: number,
	projectedAt: string,
): TemporalTaskQueueSnapshotWrite {
	const field = `snapshots[${index}]`;
	const record = normalizeRecord(value, field);
	return {
		backlog: normalizeCountMetric(record.backlog, `${field}.backlog`),
		namespace: normalizeRequiredString(record.namespace, `${field}.namespace`),
		oldestTaskAge: normalizeDurationMetric(record.oldestTaskAge, `${field}.oldestTaskAge`),
		pollerCount: normalizeNonNegativeInteger(record.pollerCount, `${field}.pollerCount`),
		pollerIdentities: normalizeStringArray(record.pollerIdentities, `${field}.pollerIdentities`),
		projectedAt,
		sampledAt: normalizeIsoTimestamp(record.sampledAt, `${field}.sampledAt`),
		scheduleToStartLatency: normalizeDurationMetric(
			record.scheduleToStartLatency,
			`${field}.scheduleToStartLatency`,
		),
		snapshotId: normalizeRequiredString(record.snapshotId, `${field}.snapshotId`),
		source: normalizeRequiredString(record.source, `${field}.source`),
		taskQueue: normalizeRequiredString(record.taskQueue, `${field}.taskQueue`),
		taskQueueKind: normalizeTaskQueueKind(record.taskQueueKind, `${field}.taskQueueKind`),
	};
}

function normalizeDecisionProjection(
	value: unknown,
	index: number,
	projectedAt: string,
): WorkerAutoscalerDecisionWrite {
	const field = `decisions[${index}]`;
	const record = normalizeRecord(value, field);
	return {
		budgetState: normalizeBudgetState(record.budgetState, `${field}.budgetState`),
		currentReplicas: normalizeNonNegativeInteger(
			record.currentReplicas,
			`${field}.currentReplicas`,
		),
		decidedAt: normalizeIsoTimestamp(record.decidedAt, `${field}.decidedAt`),
		decision: normalizeDecision(record.decision, `${field}.decision`),
		decisionId: normalizeRequiredString(record.decisionId, `${field}.decisionId`),
		desiredReplicas: normalizeNonNegativeInteger(
			record.desiredReplicas,
			`${field}.desiredReplicas`,
		),
		evidence: normalizeRecordCopy(record.evidence, `${field}.evidence`),
		projectedAt,
		reason: normalizeRequiredString(record.reason, `${field}.reason`),
		sourceSnapshotId: normalizeRequiredString(record.sourceSnapshotId, `${field}.sourceSnapshotId`),
		targetService: normalizeRequiredString(record.targetService, `${field}.targetService`),
		taskQueue: normalizeRequiredString(record.taskQueue, `${field}.taskQueue`),
		taskQueueKind: normalizeTaskQueueKind(record.taskQueueKind, `${field}.taskQueueKind`),
	};
}

function normalizeActuation(
	value: unknown,
	index: number,
	projectedAt: string,
): WorkerAutoscalerActuationWrite {
	const field = `actuations[${index}]`;
	const record = normalizeRecord(value, field);
	return {
		actedAt: normalizeIsoTimestamp(record.actedAt, `${field}.actedAt`),
		action: normalizeRequiredString(record.action, `${field}.action`),
		actuationId: normalizeRequiredString(record.actuationId, `${field}.actuationId`),
		actuatorKind: normalizeRequiredString(record.actuatorKind, `${field}.actuatorKind`),
		decisionId: normalizeRequiredString(record.decisionId, `${field}.decisionId`),
		errorCode: normalizeNullableString(record.errorCode),
		fromReplicas: normalizeNonNegativeInteger(record.fromReplicas, `${field}.fromReplicas`),
		projectedAt,
		status: normalizeActuationStatus(record.status, `${field}.status`),
		targetService: normalizeRequiredString(record.targetService, `${field}.targetService`),
		toReplicas: normalizeNonNegativeInteger(record.toReplicas, `${field}.toReplicas`),
	};
}

export function normalizeTemporalTaskQueueRuntimePayload(
	payload: unknown,
	input: {
		projectedAt: string;
	},
): NormalizedTemporalTaskQueueRuntimePayload {
	assertNoForbiddenTemporalRuntimeFields(payload);
	const record = normalizeRecord(payload, "payload");
	const schemaVersion = normalizeRequiredString(record.schemaVersion, "schemaVersion");
	if (schemaVersion !== SCHEMA_VERSION) {
		throw validationError("schemaVersion", `schemaVersion must be ${SCHEMA_VERSION}.`);
	}
	const snapshots = normalizeArray(record.snapshots, "snapshots").map((item, index) =>
		normalizeSnapshot(item, index, input.projectedAt),
	);
	const decisions = normalizeArray(record.decisions, "decisions").map((item, index) =>
		normalizeDecisionProjection(item, index, input.projectedAt),
	);
	const actuations = normalizeArray(record.actuations, "actuations").map((item, index) =>
		normalizeActuation(item, index, input.projectedAt),
	);
	return { actuations, decisions, snapshots };
}
