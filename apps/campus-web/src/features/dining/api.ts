import type {
	DiningReportReason,
	DiningReview,
	DiningReviewPage,
	DiningWindowMenuResponse,
} from "@campus-agent/dining/domain";
import { requestJson } from "@/platform/api/client";
import type { DiningMapResponse } from "./model";

export async function getDiningMap(
	input: { signal?: AbortSignal } = {},
): Promise<DiningMapResponse> {
	const [{ DiningMapResponseSchema }, response] = await Promise.all([
		import("@campus-agent/dining/domain"),
		requestJson<unknown>({
			path: "/api/dining",
			...(input.signal ? { signal: input.signal } : {}),
		}),
	]);
	return DiningMapResponseSchema.parse(response);
}

export async function getDiningWindowMenu(
	windowId: string,
	input: { signal?: AbortSignal } = {},
): Promise<DiningWindowMenuResponse> {
	const [{ DiningWindowMenuResponseSchema }, response] = await Promise.all([
		import("@campus-agent/dining/domain"),
		requestJson<unknown>({
			path: `/api/dining/windows/${encodeURIComponent(windowId)}/menu`,
			...(input.signal ? { signal: input.signal } : {}),
		}),
	]);
	return DiningWindowMenuResponseSchema.parse(response);
}

export async function getDiningReviews(input: {
	cursor?: string | null;
	menuItemId: string;
	signal?: AbortSignal;
}): Promise<DiningReviewPage> {
	const query = new URLSearchParams({ limit: "20" });
	if (input.cursor) {
		query.set("cursor", input.cursor);
	}
	const [{ DiningReviewPageSchema }, response] = await Promise.all([
		import("@campus-agent/dining/domain"),
		requestJson<unknown>({
			path: `/api/dining/menu-items/${encodeURIComponent(input.menuItemId)}/reviews?${query}`,
			...(input.signal ? { signal: input.signal } : {}),
		}),
	]);
	return DiningReviewPageSchema.parse(response);
}

export async function createDiningReview(input: {
	anonymous: boolean;
	body: string;
	idempotencyKey: string;
	menuItemId: string;
}): Promise<DiningReview> {
	const [{ DiningReviewSchema }, response] = await Promise.all([
		import("@campus-agent/dining/domain"),
		requestJson<unknown>({
			body: JSON.stringify({ anonymous: input.anonymous, body: input.body }),
			headers: {
				"content-type": "application/json",
				"idempotency-key": input.idempotencyKey,
			},
			method: "POST",
			path: `/api/dining/menu-items/${encodeURIComponent(input.menuItemId)}/reviews`,
		}),
	]);
	return DiningReviewSchema.parse(response);
}

export async function deleteDiningReview(reviewId: string): Promise<void> {
	await requestJson<void>({
		method: "DELETE",
		path: `/api/dining/reviews/${encodeURIComponent(reviewId)}`,
	});
}

export async function reportDiningReview(input: {
	details: string | null;
	reason: DiningReportReason;
	reviewId: string;
}): Promise<void> {
	await requestJson<unknown>({
		body: JSON.stringify({ details: input.details, reason: input.reason }),
		headers: { "content-type": "application/json" },
		method: "POST",
		path: `/api/dining/reviews/${encodeURIComponent(input.reviewId)}/reports`,
	});
}
