import {
	DiningMenuItemListResponseSchema,
	DiningMenuItemResponseSchema,
	DiningOpsReportPageSchema,
	DiningOpsReviewDetailSchema,
	DiningOpsReviewPageSchema,
	DiningOpsReviewResponseSchema,
} from "@campus-agent/dining/domain";
import type { DiningFloorplanBundleV1 } from "@campus-agent/dining/floorplans";
import {
	type CampusGroupsCatalog,
	CampusGroupsCatalogSchema,
} from "campus-contracts/campus-groups";
import {
	DiningDraftResponseSchema,
	DiningOpsStateResponseSchema,
	DiningReleaseListResponseSchema,
	DiningReleaseResponseSchema,
	DiningRestoreResponseSchema,
} from "../shared/dining-contract";
import type {
	ModelSettingKind,
	ModelSettingUpdate,
	OpsOverviewWindow,
	OpsRequestListView,
	OpsRequestSummary,
	OpsRequestWindow,
} from "../shared/ops-contract";
import {
	ExecutionModelSettingsStatusSchema,
	ModelSettingValidationResponseSchema,
	OpsObservabilityResponseSchema,
	OpsOverviewResponseSchema,
	OpsRequestDetailResponseSchema,
	OpsRequestListResponseSchema,
	OpsSentryIssuesResponseSchema,
} from "../shared/ops-contract";

export interface OpsRequestListParams {
	conversationId?: string;
	cursor?: string;
	q?: string;
	requestId?: string;
	runId?: string;
	status?: OpsRequestSummary["status"];
	traceId?: string;
	view?: OpsRequestListView;
	window?: OpsRequestWindow;
	workflowId?: string;
}

export async function fetchExecutionModelSettings(input: { signal?: AbortSignal } = {}) {
	return ExecutionModelSettingsStatusSchema.parse(
		await fetchJson("/api/ops/model-settings/execution", { signal: input.signal }),
	);
}

export async function putExecutionModelSetting(
	kind: ModelSettingKind,
	payload: ModelSettingUpdate,
	etag: string,
) {
	return ExecutionModelSettingsStatusSchema.parse(
		await fetchJson(`/api/ops/model-settings/execution/${kind}`, {
			body: JSON.stringify(payload),
			headers: {
				"content-type": "application/json",
				"if-match": etag,
			},
			method: "PUT",
		}),
	);
}

export async function validateExecutionModelSetting(kind: ModelSettingKind) {
	return ModelSettingValidationResponseSchema.parse(
		await fetchJson(`/api/ops/model-settings/execution/${kind}/validate`, { method: "POST" }),
	);
}

export class OpsApiError extends Error {
	readonly code: string;
	readonly details: Record<string, unknown>;
	readonly input: string;
	readonly reasonCode?: string;
	readonly status: number;

	constructor(
		message: string,
		input: string,
		status: number,
		code: string,
		reasonCode?: string,
		details: Record<string, unknown> = {},
	) {
		super(message);
		this.code = code;
		this.details = details;
		this.input = input;
		this.name = "OpsApiError";
		this.reasonCode = reasonCode;
		this.status = status;
	}
}

async function fetchJson(input: string, init?: RequestInit) {
	const response = await fetch(input, init);
	if (!response.ok) {
		const error = await readErrorBody(response);
		throw new OpsApiError(
			error.message ?? `请求失败：HTTP ${response.status}`,
			input,
			response.status,
			error.code ?? "OPS_API_REQUEST_FAILED",
			error.reasonCode,
			error.details ?? {},
		);
	}
	if (response.status === 204) {
		return null;
	}
	return response.json() as Promise<unknown>;
}

async function readErrorBody(response: Response): Promise<{
	code?: string;
	details?: Record<string, unknown>;
	message?: string;
	reasonCode?: string;
}> {
	try {
		const body = (await response.json()) as unknown;
		if (
			body &&
			typeof body === "object" &&
			"error" in body &&
			body.error &&
			typeof body.error === "object"
		) {
			const error = body.error as Record<string, unknown>;
			const details = Object.fromEntries(
				Object.entries(error).filter(
					([key, value]) => !["code", "message", "reasonCode"].includes(key) && value !== undefined,
				),
			);
			return {
				code: typeof error.code === "string" ? error.code : undefined,
				details,
				message: typeof error.message === "string" ? error.message : undefined,
				reasonCode: typeof error.reasonCode === "string" ? error.reasonCode : undefined,
			};
		}
	} catch {
		return {};
	}
	return {};
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
	kind: "logs" | "trace",
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

export async function fetchDiningState(input: { signal?: AbortSignal } = {}) {
	return DiningOpsStateResponseSchema.parse(
		await fetchJson("/api/ops/dining", { signal: input.signal }),
	);
}

export async function saveDiningDraft(input: {
	bundle: DiningFloorplanBundleV1;
	expectedRevision: number;
}) {
	return DiningDraftResponseSchema.parse(
		await fetchJson("/api/ops/dining/draft", {
			body: JSON.stringify(input),
			headers: { "content-type": "application/json" },
			method: "PUT",
		}),
	);
}

export async function publishDiningDraft(expectedRevision: number) {
	return DiningReleaseResponseSchema.parse(
		await fetchJson("/api/ops/dining/publish", {
			body: JSON.stringify({ expectedRevision }),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
}

export async function fetchDiningReleases(input: { signal?: AbortSignal } = {}) {
	return DiningReleaseListResponseSchema.parse(
		await fetchJson("/api/ops/dining/releases", { signal: input.signal }),
	);
}

export async function restoreDiningRelease(input: { expectedRevision: number; releaseId: string }) {
	return DiningRestoreResponseSchema.parse(
		await fetchJson(`/api/ops/dining/releases/${encodeURIComponent(input.releaseId)}/restore`, {
			body: JSON.stringify({ expectedRevision: input.expectedRevision }),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
}

export async function fetchDiningMenuItems(input: { signal?: AbortSignal } = {}) {
	return DiningMenuItemListResponseSchema.parse(
		await fetchJson("/api/ops/dining/menu-items", { signal: input.signal }),
	);
}

export async function createDiningMenuItem(input: {
	name: string;
	priceText: string | null;
	windowId: string;
}) {
	return DiningMenuItemResponseSchema.parse(
		await fetchJson("/api/ops/dining/menu-items", {
			body: JSON.stringify(input),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
}

export async function updateDiningMenuItem(
	menuItemId: string,
	input: { name?: string; priceText?: string | null },
) {
	return DiningMenuItemResponseSchema.parse(
		await fetchJson(`/api/ops/dining/menu-items/${encodeURIComponent(menuItemId)}`, {
			body: JSON.stringify(input),
			headers: { "content-type": "application/json" },
			method: "PATCH",
		}),
	);
}

export async function moveDiningMenuItem(menuItemId: string, windowId: string) {
	return DiningMenuItemResponseSchema.parse(
		await fetchJson(`/api/ops/dining/menu-items/${encodeURIComponent(menuItemId)}/move`, {
			body: JSON.stringify({ windowId }),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
	);
}

export async function setDiningMenuItemArchived(menuItemId: string, archived: boolean) {
	return DiningMenuItemResponseSchema.parse(
		await fetchJson(
			`/api/ops/dining/menu-items/${encodeURIComponent(menuItemId)}/${archived ? "archive" : "restore"}`,
			{ method: "POST" },
		),
	);
}

export async function reorderDiningMenuItems(windowId: string, menuItemIds: string[]) {
	return DiningMenuItemListResponseSchema.parse(
		await fetchJson(`/api/ops/dining/windows/${encodeURIComponent(windowId)}/menu-order`, {
			body: JSON.stringify({ menuItemIds }),
			headers: { "content-type": "application/json" },
			method: "PUT",
		}),
	);
}

export interface DiningReviewListParams {
	cursor?: string;
	limit?: number;
	menuItemId?: string;
	q?: string;
	visibility?: "deleted" | "hidden" | "visible";
	windowId?: string;
}

export async function fetchDiningReviews(
	params: DiningReviewListParams = {},
	input: { signal?: AbortSignal } = {},
) {
	const query = queryString({
		cursor: params.cursor,
		limit: params.limit,
		menu_item_id: params.menuItemId,
		q: params.q,
		visibility: params.visibility,
		window_id: params.windowId,
	});
	return DiningOpsReviewPageSchema.parse(
		await fetchJson(`/api/ops/dining/reviews${query}`, { signal: input.signal }),
	);
}

export async function fetchDiningReview(reviewId: string, input: { signal?: AbortSignal } = {}) {
	return DiningOpsReviewDetailSchema.parse(
		await fetchJson(`/api/ops/dining/reviews/${encodeURIComponent(reviewId)}`, {
			signal: input.signal,
		}),
	);
}

export async function createDiningReview(input: {
	anonymous: boolean;
	body: string;
	idempotencyKey: string;
	menuItemId: string;
}) {
	return DiningOpsReviewResponseSchema.parse(
		await fetchJson(
			`/api/ops/dining/reviews?menu_item_id=${encodeURIComponent(input.menuItemId)}`,
			{
				body: JSON.stringify({ anonymous: input.anonymous, body: input.body }),
				headers: {
					"content-type": "application/json",
					"idempotency-key": input.idempotencyKey,
				},
				method: "POST",
			},
		),
	);
}

export async function updateDiningReview(reviewId: string, body: string) {
	return DiningOpsReviewResponseSchema.parse(
		await fetchJson(`/api/ops/dining/reviews/${encodeURIComponent(reviewId)}`, {
			body: JSON.stringify({ body }),
			headers: { "content-type": "application/json" },
			method: "PATCH",
		}),
	);
}

export async function setDiningReviewVisible(reviewId: string, visible: boolean) {
	return DiningOpsReviewResponseSchema.parse(
		await fetchJson(`/api/ops/dining/reviews/${encodeURIComponent(reviewId)}/visibility`, {
			body: JSON.stringify({ visible }),
			headers: { "content-type": "application/json" },
			method: "PUT",
		}),
	);
}

export async function deleteDiningOperatorReview(reviewId: string) {
	await fetchJson(`/api/ops/dining/reviews/${encodeURIComponent(reviewId)}`, {
		method: "DELETE",
	});
}

export async function fetchDiningReports(
	params: { cursor?: string; limit?: number; status: "pending" | "resolved" },
	input: { signal?: AbortSignal } = {},
) {
	const query = queryString(params);
	return DiningOpsReportPageSchema.parse(
		await fetchJson(`/api/ops/dining/reports${query}`, { signal: input.signal }),
	);
}

export async function resolveDiningReports(reviewId: string, resolution: "hide" | "keep") {
	await fetchJson(`/api/ops/dining/reviews/${encodeURIComponent(reviewId)}/reports/resolve`, {
		body: JSON.stringify({ resolution }),
		headers: { "content-type": "application/json" },
		method: "POST",
	});
}

export async function fetchCampusGroupsCatalog(input: { signal?: AbortSignal } = {}) {
	return CampusGroupsCatalogSchema.parse(
		await fetchJson("/api/ops/groups/catalog", { signal: input.signal }),
	);
}

export async function replaceCampusGroupsCatalog(
	catalog: CampusGroupsCatalog,
): Promise<CampusGroupsCatalog> {
	return CampusGroupsCatalogSchema.parse(
		await fetchJson("/api/ops/groups/catalog", {
			body: JSON.stringify(catalog),
			headers: { "content-type": "application/json" },
			method: "PUT",
		}),
	);
}

function queryString(values: Record<string, string | number | undefined>): string {
	const query = new URLSearchParams();
	for (const [key, value] of Object.entries(values)) {
		if (value !== undefined && value !== "") {
			query.set(key, String(value));
		}
	}
	return query.size > 0 ? `?${query.toString()}` : "";
}
