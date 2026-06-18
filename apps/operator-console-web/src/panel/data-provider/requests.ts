import {
	normalizeRequestRecord,
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
