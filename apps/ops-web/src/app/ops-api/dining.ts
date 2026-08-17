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
	DiningDraftResponseSchema,
	DiningOpsStateResponseSchema,
	DiningReleaseListResponseSchema,
	DiningReleaseResponseSchema,
	DiningRestoreResponseSchema,
} from "../../shared/dining-contract";
import { fetchJson, queryString } from "./core";

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
