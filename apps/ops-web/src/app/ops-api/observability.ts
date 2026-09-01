import type {
	OpsOverviewWindow,
	OpsRequestListView,
	OpsRequestSummary,
	OpsRequestWindow,
} from "../../shared/ops-contract";
import {
	OpsOverviewResponseSchema,
	OpsRequestDetailResponseSchema,
	OpsRequestListResponseSchema,
} from "../../shared/ops-contract";
import { fetchJson } from "./core";

export interface OpsRequestListParams {
	cursor?: string | undefined;
	q?: string | undefined;
	requestId?: string | undefined;
	status?: OpsRequestSummary["status"] | undefined;
	view?: OpsRequestListView | undefined;
	window?: OpsRequestWindow | undefined;
}

export async function fetchOpsRequests(
	params: OpsRequestListParams = {},
	input: { signal?: AbortSignal } = {},
) {
	const query = new URLSearchParams();
	const apiParams = {
		cursor: params.cursor,
		q: params.q,
		requestId: params.requestId,
		status: params.status,
		view: params.view === "attention" ? params.view : undefined,
		window: params.window,
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
	window: OpsOverviewWindow = "1h",
	input: { signal?: AbortSignal } = {},
) {
	const query = new URLSearchParams({ window });
	return OpsOverviewResponseSchema.parse(
		await fetchJson(`/api/ops/overview?${query.toString()}`, { signal: input.signal }),
	);
}
