import { type GetListParams, HttpError } from "react-admin";

import type {
	OperatorAggregateFilterInput,
	OperatorOverviewWindow,
	OperatorTimeseriesFilterInput,
	OperatorTimeseriesGranularity,
} from "../types";
import { normalizeFilterValue } from "./cursor";

const DEFAULT_OPERATOR_WINDOW: OperatorOverviewWindow = "24h";
const OPERATOR_TIMESERIES_GRANULARITIES = new Set<OperatorTimeseriesGranularity>([
	"5m",
	"15m",
	"1h",
	"1d",
]);

export function appendRequestFilters(query: URLSearchParams, filter: GetListParams["filter"]) {
	const q = normalizeFilterValue(filter?.q);
	const requestId = normalizeFilterValue(filter?.requestId);
	const conversationId = normalizeFilterValue(filter?.conversationId);
	const status = normalizeFilterValue(filter?.status);
	const surface = normalizeFilterValue(filter?.surface);

	if (q) {
		query.set("q", q);
	}
	if (requestId) {
		query.set("requestId", requestId);
	}
	if (conversationId) {
		query.set("conversationId", conversationId);
	}
	if (status) {
		query.set("status", status);
	}
	if (surface) {
		query.set("surface", surface);
	}
}

export function appendOfficialWebRunFilters(
	query: URLSearchParams,
	filter: GetListParams["filter"],
) {
	const siteId = normalizeFilterValue(filter?.siteId);
	const status = normalizeFilterValue(filter?.status);
	const ingestionDispatchStatus = normalizeFilterValue(filter?.ingestionDispatchStatus);
	const runIntent = normalizeFilterValue(filter?.runIntent);

	if (siteId) {
		query.set("siteId", siteId);
	}
	if (status) {
		query.set("status", status);
	}
	if (ingestionDispatchStatus) {
		query.set("ingestionDispatchStatus", ingestionDispatchStatus);
	}
	if (runIntent) {
		query.set("runIntent", runIntent);
	}
}

export function appendOfficialWebTargetJobFilters(
	query: URLSearchParams,
	filter: GetListParams["filter"],
) {
	appendOptionalQueryParam(query, "siteId", filter?.siteId);
	appendOptionalQueryParam(query, "status", filter?.status);
	appendOptionalQueryParam(query, "targetId", filter?.targetId);
}

export function appendOfficialWebTargetInventoryFilters(
	query: URLSearchParams,
	filter: GetListParams["filter"],
) {
	appendOptionalQueryParam(query, "consumerFamily", filter?.consumerFamily);
	appendOptionalQueryParam(query, "ownerSurface", filter?.ownerSurface);
	appendOptionalQueryParam(query, "reviewState", filter?.reviewState);
	appendOptionalQueryParam(query, "siteId", filter?.siteId);
}

export function appendAuthenticatedNoticeProcessingFilters(
	query: URLSearchParams,
	filter: GetListParams["filter"],
) {
	appendOptionalQueryParam(query, "noticeId", filter?.noticeId);
	appendOptionalQueryParam(query, "q", filter?.q);
	appendOptionalQueryParam(query, "status", filter?.status);
	appendOptionalQueryParam(query, "targetSurface", filter?.targetSurface);
	appendOptionalQueryParam(query, "candidateKind", filter?.candidateKind);
	appendOptionalQueryParam(query, "queueStatus", filter?.queueStatus);
	appendOptionalQueryParam(query, "runId", filter?.runId);
	appendOptionalQueryParam(query, "replayBatchId", filter?.replayBatchId);
	appendOptionalQueryParam(query, "updatedAfter", filter?.updatedAfter);
	appendOptionalQueryParam(query, "updatedBefore", filter?.updatedBefore);
}

export function appendAuthenticatedNoticeRunProcessingFilters(
	query: URLSearchParams,
	filter: GetListParams["filter"],
) {
	appendOptionalQueryParam(query, "collectorRunToken", filter?.collectorRunToken);
	appendOptionalQueryParam(query, "q", filter?.q);
	appendOptionalQueryParam(query, "status", filter?.status);
	appendOptionalQueryParam(query, "queueStatus", filter?.queueStatus);
	appendOptionalQueryParam(query, "replayBatchId", filter?.replayBatchId);
	appendOptionalQueryParam(query, "runId", filter?.runId);
	appendOptionalQueryParam(query, "siteId", filter?.siteId);
	appendOptionalQueryParam(query, "sourceSurface", filter?.sourceSurface);
	appendOptionalQueryParam(query, "updatedAfter", filter?.updatedAfter);
	appendOptionalQueryParam(query, "updatedBefore", filter?.updatedBefore);
}

export function appendOptionalQueryParam(query: URLSearchParams, key: string, value: unknown) {
	const normalized = normalizeFilterValue(value);
	if (normalized) {
		query.set(key, normalized);
	}
}

function resolveOperatorWindow(
	value: OperatorOverviewWindow | null | undefined,
): OperatorOverviewWindow {
	return value ?? DEFAULT_OPERATOR_WINDOW;
}

function resolveOperatorGranularity(
	value: OperatorTimeseriesGranularity | null | undefined,
): OperatorTimeseriesGranularity | null {
	if (!value) {
		return null;
	}

	return OPERATOR_TIMESERIES_GRANULARITIES.has(value) ? value : null;
}

function validateOperatorTimeseriesWindow(
	window: OperatorOverviewWindow,
	granularity: OperatorTimeseriesGranularity | null,
): void {
	if (!granularity) {
		return;
	}

	const allowed =
		window === "15m"
			? new Set<OperatorTimeseriesGranularity>(["5m"])
			: window === "1h"
				? new Set<OperatorTimeseriesGranularity>(["5m", "15m"])
				: window === "24h"
					? new Set<OperatorTimeseriesGranularity>(["15m", "1h"])
					: window === "7d"
						? new Set<OperatorTimeseriesGranularity>(["1h", "1d"])
						: new Set<OperatorTimeseriesGranularity>(["1d"]);

	if (!allowed.has(granularity)) {
		throw new HttpError("window and granularity combination is invalid.", 400, {
			error: {
				code: "validation_failed",
				message: "window and granularity combination is invalid.",
			},
		});
	}
}

export function appendOperatorAggregateFilters(
	query: URLSearchParams,
	filter: OperatorAggregateFilterInput | undefined,
) {
	query.set("window", resolveOperatorWindow(filter?.window));
	appendOptionalQueryParam(query, "surface", filter?.surface);
	appendOptionalQueryParam(query, "selectedTarget", filter?.selectedTarget);
	appendOptionalQueryParam(query, "requestedCapability", filter?.requestedCapability);
	appendOptionalQueryParam(query, "principalType", filter?.principalType);
	appendOptionalQueryParam(query, "collection", filter?.collection);
	appendOptionalQueryParam(query, "modelName", filter?.modelName);
}

export function appendOperatorTimeseriesFilters(
	query: URLSearchParams,
	filter: OperatorTimeseriesFilterInput | undefined,
) {
	const window = resolveOperatorWindow(filter?.window);
	const granularity = resolveOperatorGranularity(filter?.granularity);
	validateOperatorTimeseriesWindow(window, granularity);
	query.set("window", window);
	if (granularity) {
		query.set("granularity", granularity);
	}
	appendOptionalQueryParam(query, "surface", filter?.surface);
	appendOptionalQueryParam(query, "selectedTarget", filter?.selectedTarget);
	appendOptionalQueryParam(query, "requestedCapability", filter?.requestedCapability);
	appendOptionalQueryParam(query, "principalType", filter?.principalType);
	appendOptionalQueryParam(query, "collection", filter?.collection);
	appendOptionalQueryParam(query, "modelName", filter?.modelName);
}
