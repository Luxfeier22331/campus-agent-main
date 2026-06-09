import { AppApiRouteError } from "../../http";
import type {
	NormalizedOperatorAuditListFilters,
	NormalizedOperatorOverviewFilters,
	NormalizedOperatorQualityBadcaseListFilters,
	NormalizedOperatorRequestListFilters,
	NormalizedOperatorSafetyAnomalyListFilters,
	OperatorAuditListFilters,
	OperatorOverviewFilters,
	OperatorOverviewWindow,
	OperatorQualityBadcaseListFilters,
	OperatorResultWindow,
	OperatorSafetyAnomalyListFilters,
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
		collection: normalizeOptionalString(filters.collection),
		granularity: granularity ? (granularity as OperatorResultWindow["granularity"]) : null,
		modelName: normalizeOptionalString(filters.modelName),
		principalType: normalizeOptionalString(filters.principalType),
		requestedCapability: normalizeOptionalString(filters.requestedCapability),
		selectedCapability: normalizeOptionalString(filters.selectedCapability),
		surface: normalizeOptionalString(filters.surface),
		window: normalizeOverviewWindow(filters.window),
	};
}

export function normalizeAuditListFilters(
	filters: OperatorAuditListFilters,
): NormalizedOperatorAuditListFilters {
	return {
		cursor: normalizeOptionalString(filters.cursor),
		eventType: normalizeOptionalString(filters.eventType),
		limit: normalizeLimit(filters.limit),
		principalType: normalizeOptionalString(filters.principalType),
		requestId: normalizeOptionalString(filters.requestId),
		selectedCapability: normalizeOptionalString(filters.selectedCapability),
		status: normalizeOptionalString(filters.status),
		surface: normalizeOptionalString(filters.surface),
		traceId: normalizeOptionalString(filters.traceId),
	};
}

export function normalizeQualityBadcaseListFilters(
	filters: OperatorQualityBadcaseListFilters,
): NormalizedOperatorQualityBadcaseListFilters {
	const window = normalizeOptionalString(filters.window);
	return {
		causeClass: normalizeOptionalString(filters.causeClass),
		cursor: normalizeOptionalString(filters.cursor),
		detectedBy: normalizeOptionalString(filters.detectedBy),
		limit: normalizeLimit(filters.limit),
		selectedCapability: normalizeOptionalString(filters.selectedCapability),
		status: normalizeOptionalString(filters.status),
		surface: normalizeOptionalString(filters.surface),
		window: window ? normalizeOverviewWindow(window) : null,
	};
}

export function normalizeSafetyAnomalyListFilters(
	filters: OperatorSafetyAnomalyListFilters,
): NormalizedOperatorSafetyAnomalyListFilters {
	const window = normalizeOptionalString(filters.window);
	return {
		anomalyCode: normalizeOptionalString(filters.anomalyCode),
		cursor: normalizeOptionalString(filters.cursor),
		limit: normalizeLimit(filters.limit),
		selectedCapability: normalizeOptionalString(filters.selectedCapability),
		severity: normalizeOptionalString(filters.severity),
		status: normalizeOptionalString(filters.status),
		surface: normalizeOptionalString(filters.surface),
		window: window ? normalizeOverviewWindow(window) : null,
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
