import type { GetListParams, Identifier } from "react-admin";

import { fetchJson } from "../http";
import {
	type AuthenticatedNoticeRunProcessingRecord,
	normalizeAuthenticatedNoticeRunProcessingRecord,
	type RawAuthenticatedNoticeRunProcessingDetailResponse,
	type RawAuthenticatedNoticeRunProcessingListResponse,
} from "../types";
import { getSequentialCursorList } from "./cursor";
import { appendAuthenticatedNoticeRunProcessingFilters } from "./filters";
import { encodePathIdentifier } from "./path";

export async function getAuthenticatedNoticeRunProcessingList(params: GetListParams): Promise<{
	data: AuthenticatedNoticeRunProcessingRecord[];
	pageInfo: {
		hasNextPage: boolean;
		hasPreviousPage: boolean;
	};
}> {
	return getSequentialCursorList<
		RawAuthenticatedNoticeRunProcessingListResponse,
		RawAuthenticatedNoticeRunProcessingListResponse["runs"][number],
		AuthenticatedNoticeRunProcessingRecord
	>({
		buildQuery(query) {
			appendAuthenticatedNoticeRunProcessingFilters(query, params.filter);
		},
		cursorFilter: params.filter,
		normalizeRecord: normalizeAuthenticatedNoticeRunProcessingRecord,
		page: params.pagination?.page,
		perPage: params.pagination?.perPage,
		resource: "authenticatedNoticeRunProcessing",
		resourceLabel: "authenticated notice run processing record",
		responseItems(payload) {
			return payload.runs;
		},
		signal: params.signal,
		sourcePath: "/api/authenticated-notices/run-processing",
	});
}

export async function getAuthenticatedNoticeRunProcessingDetail(
	id: Identifier,
	signal?: AbortSignal,
): Promise<{ data: AuthenticatedNoticeRunProcessingRecord }> {
	const payload = await fetchJson<RawAuthenticatedNoticeRunProcessingDetailResponse>(
		`/api/authenticated-notices/run-processing/${encodePathIdentifier(id)}`,
		{
			signal,
		},
	);

	return {
		data: normalizeAuthenticatedNoticeRunProcessingRecord(payload.run),
	};
}
