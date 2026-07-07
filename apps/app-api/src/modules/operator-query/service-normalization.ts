import { AppApiRouteError } from "../../http";
import type {
	NormalizedOperatorOverviewFilters,
	NormalizedOperatorRequestListFilters,
	NormalizedTemporalTaskQueueListFilters,
	NormalizedWorkerAutoscalerActuationListFilters,
	NormalizedWorkerAutoscalerPostureListFilters,
	OperatorOverviewFilters,
	OperatorOverviewWindow,
	OperatorResultWindow,
	TemporalTaskQueueKind,
	TemporalTaskQueueListFilters,
	WorkerAutoscalerActuationListFilters,
	WorkerAutoscalerActuationStatus,
	WorkerAutoscalerPostureListFilters,
	WorkerAutoscalerScalerStatus,
} from "./service-types";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const DEFAULT_WINDOW: OperatorOverviewWindow = "24h";
const OPERATOR_WINDOWS = new Set<OperatorOverviewWindow>(["15m", "1h", "24h", "7d", "30d"]);
const OPERATOR_GRANULARITIES = new Set<OperatorResultWindow["granularity"]>([
	"5m",
	"15m",
	"1h",
	"1d",
]);
const TEMPORAL_TASK_QUEUE_KINDS = new Set(["workflow", "activity"]);
const WORKER_AUTOSCALER_ACTUATION_STATUSES = new Set(["applied", "skipped", "failed"]);
const WORKER_AUTOSCALER_SCALER_STATUSES = new Set(["healthy", "degraded", "paused", "disabled"]);

function validationFailed(message: string): AppApiRouteError {
	return new AppApiRouteError({
		code: "validation_failed",
		message,
		retryable: false,
		status: 400,
	});
}

export function normalizeOptionalString(value: string | null | undefined): string | null {
	const normalized = value?.trim();
	return normalized ? normalized : null;
}

export function normalizeLimit(value: number | null | undefined): number {
	if (!(Number.isFinite(value) && value) || value < 1) {
		return DEFAULT_LIMIT;
	}

	return Math.min(Math.floor(value), MAX_LIMIT);
}

export function normalizeOverviewWindow(value: string | null | undefined): OperatorOverviewWindow {
	const normalized = normalizeOptionalString(value);
	if (!normalized) {
		return DEFAULT_WINDOW;
	}
	if (OPERATOR_WINDOWS.has(normalized as OperatorOverviewWindow)) {
		return normalized as OperatorOverviewWindow;
	}

	throw validationFailed("window is invalid.");
}

export function normalizeOverviewFilters(
	filters: OperatorOverviewFilters,
): NormalizedOperatorOverviewFilters {
	const granularity = normalizeOptionalString(filters.granularity);
	if (
		granularity &&
		!OPERATOR_GRANULARITIES.has(granularity as OperatorResultWindow["granularity"])
	) {
		throw validationFailed("granularity is invalid.");
	}

	return {
		granularity: granularity ? (granularity as OperatorResultWindow["granularity"]) : null,
		principalType: normalizeOptionalString(filters.principalType),
		surface: normalizeOptionalString(filters.surface),
		window: normalizeOverviewWindow(filters.window),
	};
}

export function isAllowedTimeseriesGranularity(
	window: OperatorOverviewWindow,
	granularity: OperatorResultWindow["granularity"],
): boolean {
	const allowed =
		window === "15m"
			? new Set(["5m"])
			: window === "1h"
				? new Set(["5m", "15m"])
				: window === "24h"
					? new Set(["15m", "1h"])
					: window === "7d"
						? new Set(["1h", "1d"])
						: new Set(["1d"]);

	return allowed.has(granularity);
}

export function normalizeRequestListFilters(input: {
	conversationId?: string | null;
	cursor?: string | null;
	limit?: number | null;
	q?: string | null;
	requestId?: string | null;
	status?: string | null;
	surface?: string | null;
}): NormalizedOperatorRequestListFilters {
	return {
		conversationId: normalizeOptionalString(input.conversationId),
		cursor: normalizeOptionalString(input.cursor),
		limit: normalizeLimit(input.limit),
		q: normalizeOptionalString(input.q),
		requestId: normalizeOptionalString(input.requestId),
		status: normalizeOptionalString(input.status),
		surface: normalizeOptionalString(input.surface),
	};
}

export function normalizeTemporalTaskQueueListFilters(
	input: TemporalTaskQueueListFilters,
): NormalizedTemporalTaskQueueListFilters {
	const taskQueueKind = normalizeOptionalString(input.taskQueueKind);
	if (taskQueueKind && !TEMPORAL_TASK_QUEUE_KINDS.has(taskQueueKind)) {
		throw validationFailed("taskQueueKind is invalid.");
	}
	return {
		cursor: normalizeOptionalString(input.cursor),
		limit: normalizeLimit(input.limit),
		taskQueue: normalizeOptionalString(input.taskQueue),
		taskQueueKind: taskQueueKind ? (taskQueueKind as TemporalTaskQueueKind) : null,
	};
}

export function normalizeWorkerAutoscalerActuationListFilters(
	input: WorkerAutoscalerActuationListFilters,
): NormalizedWorkerAutoscalerActuationListFilters {
	const status = normalizeOptionalString(input.status);
	if (status && !WORKER_AUTOSCALER_ACTUATION_STATUSES.has(status)) {
		throw validationFailed("status is invalid.");
	}
	return {
		cursor: normalizeOptionalString(input.cursor),
		decisionId: normalizeOptionalString(input.decisionId),
		limit: normalizeLimit(input.limit),
		status: status ? (status as WorkerAutoscalerActuationStatus) : null,
		targetService: normalizeOptionalString(input.targetService),
	};
}

export function normalizeWorkerAutoscalerPostureListFilters(
	input: WorkerAutoscalerPostureListFilters,
): NormalizedWorkerAutoscalerPostureListFilters {
	const scalerStatus = normalizeOptionalString(input.scalerStatus);
	if (scalerStatus && !WORKER_AUTOSCALER_SCALER_STATUSES.has(scalerStatus)) {
		throw validationFailed("scalerStatus is invalid.");
	}
	return {
		cursor: normalizeOptionalString(input.cursor),
		limit: normalizeLimit(input.limit),
		scalerStatus: scalerStatus ? (scalerStatus as WorkerAutoscalerScalerStatus) : null,
		targetService: normalizeOptionalString(input.targetService),
	};
}
