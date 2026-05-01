import type { GetListParams, Identifier } from "react-admin";

import { fetchJson } from "../http";
import {
	normalizeAuthenticatedNoticeProcessingRecord,
	type AuthenticatedNoticeProcessingRecord,
	type RawAuthenticatedNoticeProcessingDetailResponse,
	type RawAuthenticatedNoticeProcessingListResponse,
} from "../types";
import { getSequentialCursorList } from "./cursor";
import { appendAuthenticatedNoticeProcessingFilters } from "./filters";
import { encodePathIdentifier } from "./path";

export async function getAuthenticatedNoticeProcessingList(params: GetListParams): Promise<{
	data: AuthenticatedNoticeProcessingRecord[];
	pageInfo: {
		hasNextPage: boolean;
		hasPreviousPage: boolean;
	};
}> {
	return getSequentialCursorList<
		RawAuthenticatedNoticeProcessingListResponse,
		RawAuthenticatedNoticeProcessingListResponse["notices"][number],
		AuthenticatedNoticeProcessingRecord
	>({
		buildQuery(query) {
			appendAuthenticatedNoticeProcessingFilters(query, params.filter);
		},
		cursorFilter: params.filter,
		normalizeRecord: normalizeAuthenticatedNoticeProcessingRecord,
		page: params.pagination?.page,
		perPage: params.pagination?.perPage,
		resource: "authenticatedNoticeProcessing",
		resourceLabel: "authenticated notice processing record",
		responseItems(payload) {
			return payload.notices;
		},
		signal: params.signal,
		sourcePath: "/api/authenticated-notices/processing",
	});
}

export async function getAuthenticatedNoticeProcessingDetail(
	id: Identifier,
	signal?: AbortSignal,
): Promise<{ data: AuthenticatedNoticeProcessingRecord }> {
	const payload = await fetchJson<RawAuthenticatedNoticeProcessingDetailResponse>(
		`/api/authenticated-notices/processing/${encodePathIdentifier(id)}`,
		{
			signal,
		},
	);

	return {
		data: normalizeAuthenticatedNoticeProcessingRecord(payload.notice),
	};
}
