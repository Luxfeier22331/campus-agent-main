import type { GetListParams, Identifier } from "react-admin";

import { fetchJson } from "../http";
import {
	normalizeRequestRecord,
	type RawRequestDetailResponse,
	type RawRequestListResponse,
	type RawRequestObservabilityRecord,
	type RequestObservabilityRecord,
	type RequestProjectionRecord,
} from "../types";
import { getSequentialCursorList } from "./cursor";
import { appendRequestFilters } from "./filters";
import { encodePathIdentifier } from "./path";

export async function getRequestList(params: GetListParams): Promise<{
	data: RequestProjectionRecord[];
	pageInfo: {
		hasNextPage: boolean;
		hasPreviousPage: boolean;
	};
}> {
	return getSequentialCursorList<
		RawRequestListResponse,
		RawRequestListResponse["requests"][number],
		RequestProjectionRecord
	>({
		buildQuery(query) {
			appendRequestFilters(query, params.filter);
		},
		cursorFilter: params.filter,
		normalizeRecord: normalizeRequestRecord,
		page: params.pagination?.page,
		perPage: params.pagination?.perPage,
		resource: "requests",
		resourceLabel: "request",
		responseItems(payload) {
			return payload.requests;
		},
		signal: params.signal,
		sourcePath: "/api/requests",
	});
}

export async function getRequestDetail(
	id: Identifier,
	signal?: AbortSignal,
): Promise<{ data: RequestProjectionRecord }> {
	const payload = await fetchJson<RawRequestDetailResponse>(
		`/api/requests/${encodePathIdentifier(id)}`,
		{
			signal,
		},
	);

	return {
		data: normalizeRequestRecord(payload.request),
	};
}

export async function getRequestObservabilityDetail(
	requestId: Identifier,
	signal?: AbortSignal,
): Promise<{ data: RequestObservabilityRecord }> {
	const payload = await fetchJson<RawRequestObservabilityRecord>(
		`/api/requests/${encodePathIdentifier(requestId)}/observability`,
		{
			signal,
		},
	);

	return {
		data: payload,
	};
}
