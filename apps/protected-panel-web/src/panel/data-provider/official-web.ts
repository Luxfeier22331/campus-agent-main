import type { GetListParams, Identifier } from "react-admin";

import { fetchJson } from "../http";
import {
	normalizeOfficialWebRunDetailRecord,
	normalizeOfficialWebRunRecord,
	normalizeOfficialWebSiteDetailRecord,
	normalizeOfficialWebSiteRecord,
	normalizeOfficialWebTargetInventoryRecord,
	normalizeOfficialWebTargetJobDetailRecord,
	normalizeOfficialWebTargetJobRecord,
	type OfficialWebRunRecord,
	type OfficialWebSiteRecord,
	type OfficialWebTargetInventoryRecord,
	type OfficialWebTargetJobRecord,
	type RawOfficialWebRunDetailResponse,
	type RawOfficialWebRunListResponse,
	type RawOfficialWebSiteDetailResponse,
	type RawOfficialWebSiteListResponse,
	type RawOfficialWebTargetInventoryListResponse,
	type RawOfficialWebTargetJobDetailResponse,
	type RawOfficialWebTargetJobListResponse,
} from "../types";
import { getSequentialCursorList } from "./cursor";
import {
	appendOfficialWebRunFilters,
	appendOfficialWebTargetInventoryFilters,
	appendOfficialWebTargetJobFilters,
} from "./filters";
import { encodePathIdentifier } from "./path";

export async function getOfficialWebTargetInventoryList(params: GetListParams): Promise<{
	data: OfficialWebTargetInventoryRecord[];
	pageInfo: {
		hasNextPage: boolean;
		hasPreviousPage: boolean;
	};
}> {
	return getSequentialCursorList<
		RawOfficialWebTargetInventoryListResponse,
		RawOfficialWebTargetInventoryListResponse["entries"][number],
		OfficialWebTargetInventoryRecord
	>({
		buildQuery(query) {
			appendOfficialWebTargetInventoryFilters(query, params.filter);
		},
		cursorFilter: params.filter,
		normalizeRecord: normalizeOfficialWebTargetInventoryRecord,
		page: params.pagination?.page,
		perPage: params.pagination?.perPage,
		resource: "officialWebTargetInventory",
		resourceLabel: "official web target inventory",
		responseItems(payload) {
			return payload.entries;
		},
		signal: params.signal,
		sourcePath: "/api/official-web/target-inventory",
	});
}

export async function getOfficialWebTargetJobList(params: GetListParams): Promise<{
	data: OfficialWebTargetJobRecord[];
	pageInfo: {
		hasNextPage: boolean;
		hasPreviousPage: boolean;
	};
}> {
	return getSequentialCursorList<
		RawOfficialWebTargetJobListResponse,
		RawOfficialWebTargetJobListResponse["jobs"][number],
		OfficialWebTargetJobRecord
	>({
		buildQuery(query) {
			appendOfficialWebTargetJobFilters(query, params.filter);
		},
		cursorFilter: params.filter,
		normalizeRecord: normalizeOfficialWebTargetJobRecord,
		page: params.pagination?.page,
		perPage: params.pagination?.perPage,
		resource: "officialWebTargetJobs",
		resourceLabel: "official web target job",
		responseItems(payload) {
			return payload.jobs;
		},
		signal: params.signal,
		sourcePath: "/api/official-web/target-jobs",
	});
}

export async function getOfficialWebTargetJobDetail(
	id: Identifier,
	signal?: AbortSignal,
): Promise<{ data: OfficialWebTargetJobRecord }> {
	const payload = await fetchJson<RawOfficialWebTargetJobDetailResponse>(
		`/api/official-web/target-jobs/${encodePathIdentifier(id)}`,
		{
			signal,
		},
	);

	return {
		data: normalizeOfficialWebTargetJobDetailRecord(payload.targetJob),
	};
}

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
	const payload = await fetchJson<RawOfficialWebRunDetailResponse>(
		`/api/official-web/runs/${encodePathIdentifier(id)}`,
		{
			signal,
		},
	);

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
	total: number;
}> {
	const payload = await fetchJson<RawOfficialWebSiteListResponse>("/api/official-web/sites", {
		signal,
	});
	const data = payload.sites.map(normalizeOfficialWebSiteRecord);

	return {
		data,
		pageInfo: {
			hasNextPage: false,
			hasPreviousPage: false,
		},
		total: data.length,
	};
}

export async function getOfficialWebSiteDetail(
	id: Identifier,
	signal?: AbortSignal,
): Promise<{ data: OfficialWebSiteRecord }> {
	const payload = await fetchJson<RawOfficialWebSiteDetailResponse>(
		`/api/official-web/sites/${encodePathIdentifier(id)}`,
		{
			signal,
		},
	);

	return {
		data: normalizeOfficialWebSiteDetailRecord(payload),
	};
}
