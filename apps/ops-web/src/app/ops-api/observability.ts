import type {
	OpsOverviewWindow,
	OpsRequestListView,
	OpsRequestSummary,
	OpsRequestWindow,
} from "../../shared/ops-contract";
import {
	OpsObservabilityResponseSchema,
	OpsOverviewResponseSchema,
	OpsRequestDetailResponseSchema,
	OpsRequestListResponseSchema,
	OpsSentryIssuesResponseSchema,
} from "../../shared/ops-contract";
import { fetchJson } from "./core";

export interface OpsRequestListParams {
	conversationId?: string | undefined;
	cursor?: string | undefined;
	q?: string | undefined;
	requestId?: string | undefined;
	runId?: string | undefined;
	status?: OpsRequestSummary["status"] | undefined;
	traceId?: string | undefined;
	view?: OpsRequestListView | undefined;
	window?: OpsRequestWindow | undefined;
	workflowId?: string | undefined;
}

export async function fetchOpsRequests(
	params: OpsRequestListParams = {},
	input: { signal?: AbortSignal } = {},
) {
	const query = new URLSearchParams();
	const apiParams = {
		conversationId: params.conversationId,
		cursor: params.cursor,
		q: params.q,
		requestId: params.requestId,
		runId: params.runId,
		status: params.status,
		traceId: params.traceId,
		view: params.view === "attention" ? params.view : undefined,
		window: params.window,
		workflowId: params.workflowId,
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

export async function fetchOpsObservability(
	requestId: string,
	kind: "logs",
	input: { signal?: AbortSignal } = {},
) {
	const query = new URLSearchParams({ kind });
	return OpsObservabilityResponseSchema.parse(
		await fetchJson(
			`/api/ops/requests/${encodeURIComponent(requestId)}/observability?${query.toString()}`,
			{ signal: input.signal },
		),
	);
}

export async function fetchOpsSentryIssues(
	requestId: string,
	input: { signal?: AbortSignal } = {},
) {
	return OpsSentryIssuesResponseSchema.parse(
		await fetchJson(`/api/ops/requests/${encodeURIComponent(requestId)}/sentry-issues`, {
			signal: input.signal,
		}),
	);
}
