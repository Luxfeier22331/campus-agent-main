import type { TimeQuery } from "campus-contracts/ops-time";
import { type FailureFilters, readFailureFilters } from "../../shared/failure-filters.ts";
import type { OpsRequestListView, OpsRequestSummary } from "../../shared/ops-contract";
import {
	OpsOverviewResponseSchema,
	OpsRequestDetailResponseSchema,
	OpsRequestListResponseSchema,
} from "../../shared/ops-contract";
import { fetchJson } from "./core";

export interface OpsRequestListParams extends TimeQuery, FailureFilters {
	cursor?: string | undefined;
	q?: string | undefined;
	requestId?: string | undefined;
	status?: OpsRequestSummary["status"] | undefined;
	view?: OpsRequestListView | undefined;
}

export async function fetchOpsRequests(
	params: OpsRequestListParams = {},
	input: { signal?: AbortSignal } = {},
) {
	const query = new URLSearchParams();
	const apiParams = {
		...readFailureFilters({ ...params }),
		cursor: params.cursor,
		q: params.q,
		requestId: params.requestId,
		status: params.status,
		view: params.view === "attention" ? params.view : undefined,
		window: params.window,
		from: params.from,
		to: params.to,
	};
	for (const [key, value] of Object.entries(apiParams)) {
		if (value !== undefined && value !== "") {
			query.set(key, String(value));
		}
	}
	const search = query.toString();
	return OpsRequestListResponseSchema.parse(
		await fetchJson(`/api/ops/requests${search ? `?${search}` : ""}`, {
			signal: input.signal,
		}),
	);
}

export async function fetchOpsRequestDetail(
	requestId: string,
	input: { signal?: AbortSignal } = {},
) {
	return OpsRequestDetailResponseSchema.parse(
		await fetchJson(`/api/ops/requests/${encodeURIComponent(requestId)}`, { signal: input.signal }),
	);
}

export async function fetchOpsOverview(
	params: TimeQuery = {},
	input: { signal?: AbortSignal } = {},
) {
	const query = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value) {
			query.set(key, value);
		}
	}
	return OpsOverviewResponseSchema.parse(
		await fetchJson(`/api/ops/overview?${query.toString()}`, { signal: input.signal }),
	);
}
