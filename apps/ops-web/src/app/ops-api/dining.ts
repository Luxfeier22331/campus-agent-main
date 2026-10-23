import {
	DiningMenuItemListResponseSchema,
	DiningMenuItemResponseSchema,
	DiningOpsContentReportPageSchema,
	DiningOpsContentReviewDetailSchema,
	DiningOpsContentReviewPageSchema,
	DiningOpsContentReviewResponseSchema,
	DiningOpsSubmissionDetailSchema,
	DiningOpsSubmissionPageSchema,
	DiningOpsSubmissionResponseSchema,
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
	submissionId?: string;
	targetType?: "menu_item" | "submission";
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
		submission_id: params.submissionId,
		target_type: params.targetType,
		q: params.q,
		visibility: params.visibility,
		window_id: params.windowId,
	});
	return DiningOpsContentReviewPageSchema.parse(
		await fetchJson(`/api/ops/dining/reviews${query}`, { signal: input.signal }),
	);
}

export async function fetchDiningReview(reviewId: string, input: { signal?: AbortSignal } = {}) {
	return DiningOpsContentReviewDetailSchema.parse(
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
	return DiningOpsContentReviewResponseSchema.parse(
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
	return DiningOpsContentReviewResponseSchema.parse(
		await fetchJson(`/api/ops/dining/reviews/${encodeURIComponent(reviewId)}`, {
			body: JSON.stringify({ body }),
			headers: { "content-type": "application/json" },
			method: "PATCH",
		}),
	);
}

export async function setDiningReviewVisible(reviewId: string, visible: boolean) {
	return DiningOpsContentReviewResponseSchema.parse(
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
	params: {
		cursor?: string;
		limit?: number;
		status: "pending" | "resolved";
		submissionId?: string;
		menuItemId?: string;
		targetType?: "review" | "submission";
	},
	input: { signal?: AbortSignal } = {},
) {
	const query = queryString({
		cursor: params.cursor,
		limit: params.limit,
		status: params.status,
		menu_item_id: params.menuItemId,
		submission_id: params.submissionId,
		target_type: params.targetType,
	});
	return DiningOpsContentReportPageSchema.parse(
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

export async function resolveDiningSubmissionReports(
	submissionId: string,
	expectedRevision: number,
	resolution: "hide" | "keep",
) {
	await fetchJson(
		`/api/ops/dining/submissions/${encodeURIComponent(submissionId)}/reports/resolve`,
		{
			body: JSON.stringify({ expectedRevision, resolution }),
			headers: { "content-type": "application/json" },
			method: "POST",
		},
	);
}

export interface DiningSubmissionListParams {
	cursor?: string;
	limit?: number;
	windowId?: string;
	status?: "public" | "hidden" | "deleted" | "expired" | "purged";
	reportStatus?: "pending" | "resolved";
}

export async function fetchDiningSubmissions(
	params: DiningSubmissionListParams = {},
	input: { signal?: AbortSignal } = {},
) {
	const query = queryString({
		cursor: params.cursor,
		limit: params.limit,
		window_id: params.windowId,
		status: params.status,
		report_status: params.reportStatus,
	});
	return DiningOpsSubmissionPageSchema.parse(
		await fetchJson(`/api/ops/dining/submissions${query}`, { signal: input.signal }),
	);
}

export async function fetchDiningSubmission(
	submissionId: string,
	input: { signal?: AbortSignal } = {},
) {
	return DiningOpsSubmissionDetailSchema.parse(
		await fetchJson(`/api/ops/dining/submissions/${encodeURIComponent(submissionId)}`, {
			signal: input.signal,
		}),
	);
}

export async function changeDiningSubmission(
	submissionId: string,
	expectedRevision: number,
	action: "hide" | "unhide" | "delete" | "restore",
) {
	const visibility = action === "hide" || action === "unhide";
	return DiningOpsSubmissionResponseSchema.parse(
		await fetchJson(
			`/api/ops/dining/submissions/${encodeURIComponent(submissionId)}/${visibility ? "visibility" : action}`,
			{
				method: visibility ? "PUT" : "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					expectedRevision,
					...(visibility ? { visible: action === "unhide" } : {}),
				}),
			},
		),
	);
}
