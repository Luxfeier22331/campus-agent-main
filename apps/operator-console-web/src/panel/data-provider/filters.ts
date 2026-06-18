import type { OperatorAggregateFilterInput, OperatorOverviewWindow } from "../types";
import { normalizeFilterValue } from "./cursor";

const DEFAULT_OPERATOR_WINDOW: OperatorOverviewWindow = "24h";

type QueryFilter = Record<string, unknown> | undefined;

export function appendRequestFilters(query: URLSearchParams, filter: QueryFilter) {
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

export function appendOperatorAggregateFilters(
	query: URLSearchParams,
	filter: OperatorAggregateFilterInput | undefined,
) {
	query.set("window", resolveOperatorWindow(filter?.window));
	appendOptionalQueryParam(query, "surface", filter?.surface);
	appendOptionalQueryParam(query, "selectedCapability", filter?.selectedCapability);
	appendOptionalQueryParam(query, "requestedCapability", filter?.requestedCapability);
	appendOptionalQueryParam(query, "principalType", filter?.principalType);
	appendOptionalQueryParam(query, "collection", filter?.collection);
	appendOptionalQueryParam(query, "modelName", filter?.modelName);
}
