import { fetchJson } from "../http";
import {
	normalizeRequestRecord,
	type RawRequestDetailResponse,
	type RawRequestListResponse,
	type RequestProjectionRecord,
} from "../types";
import { getSequentialCursorList } from "./cursor";
import { appendRequestFilters } from "./filters";

export interface CursorListParams {
	filter?: Record<string, unknown>;
	pagination?: {
		page?: number;
		perPage?: number;
	};
	signal?: AbortSignal;
}

export async function getRequestList(params: CursorListParams = {}): Promise<{
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

export async function getRequestDetail(input: {
	requestId: string;
	signal?: AbortSignal;
}): Promise<RequestProjectionRecord | null> {
	const payload = await fetchJson<RawRequestDetailResponse>(
		`/api/requests/${encodeURIComponent(input.requestId)}`,
		{ signal: input.signal },
	);
	return payload.request ? normalizeRequestRecord(payload.request) : null;
}
