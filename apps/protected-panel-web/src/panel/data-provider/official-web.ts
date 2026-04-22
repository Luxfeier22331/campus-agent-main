import type { GetListParams, Identifier } from "react-admin";

import { fetchJson } from "../http";
import {
	normalizeOfficialWebRunDetailRecord,
	normalizeOfficialWebRunRecord,
	normalizeOfficialWebSiteDetailRecord,
	normalizeOfficialWebSiteRecord,
	type OfficialWebRunRecord,
	type OfficialWebSiteRecord,
	type RawOfficialWebRunDetailResponse,
	type RawOfficialWebRunListResponse,
	type RawOfficialWebSiteDetailResponse,
	type RawOfficialWebSiteListResponse,
} from "../types";
import { getSequentialCursorList } from "./cursor";
import { appendOfficialWebRunFilters } from "./filters";

export async function getOfficialWebRunList(params: GetListParams): Promise<{
	data: OfficialWebRunRecord[];
	pageInfo: {
		hasNextPage: boolean;
		hasPreviousPage: boolean;
	};
}> {
	return getSequentialCursorList<
		RawOfficialWebRunListResponse,
		RawOfficialWebRunListResponse["runs"][number],
		OfficialWebRunRecord
	>({
		buildQuery(query) {
			appendOfficialWebRunFilters(query, params.filter);
		},
		cursorFilter: params.filter,
		normalizeRecord: normalizeOfficialWebRunRecord,
		page: params.pagination?.page,
		perPage: params.pagination?.perPage,
		resource: "officialWebRuns",
		resourceLabel: "official web run",
		responseItems(payload) {
			return payload.runs;
		},
		signal: params.signal,
		sourcePath: "/api/official-web/runs",
	});
}

export async function getOfficialWebRunDetail(
	id: Identifier,
	signal?: AbortSignal,
): Promise<{ data: OfficialWebRunRecord }> {
	const payload = await fetchJson<RawOfficialWebRunDetailResponse>(`/api/official-web/runs/${id}`, {
		signal,
	});

	return {
		data: normalizeOfficialWebRunDetailRecord(payload.run),
	};
}

export async function getOfficialWebSiteList(signal?: AbortSignal): Promise<{
	data: OfficialWebSiteRecord[];
	pageInfo: {
		hasNextPage: boolean;
		hasPreviousPage: boolean;
	};
}> {
	const payload = await fetchJson<RawOfficialWebSiteListResponse>("/api/official-web/sites", {
		signal,
	});

	return {
		data: payload.sites.map(normalizeOfficialWebSiteRecord),
		pageInfo: {
			hasNextPage: false,
			hasPreviousPage: false,
		},
	};
}

export async function getOfficialWebSiteDetail(
	id: Identifier,
	signal?: AbortSignal,
): Promise<{ data: OfficialWebSiteRecord }> {
	const payload = await fetchJson<RawOfficialWebSiteDetailResponse>(
		`/api/official-web/sites/${id}`,
		{
			signal,
		},
	);

	return {
		data: normalizeOfficialWebSiteDetailRecord(payload),
	};
}
