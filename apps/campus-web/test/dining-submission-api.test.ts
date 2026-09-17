import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createDiningSubmission,
	createDiningSubmissionReview,
	deleteDiningSubmission,
	getDiningSubmission,
	getDiningSubmissionReviews,
	getDiningSubmissions,
	getMyDiningSubmission,
	getMyDiningSubmissions,
	reportDiningSubmission,
	updateDiningSubmission,
} from "../src/features/dining/submission-api";
import {
	diningSubmissionsInfiniteQueryOptions,
	myDiningSubmissionsInfiniteQueryOptions,
} from "../src/features/dining/submission-queries";

const at = "2026-09-15T00:00:00.000Z";
const own = {
	submissionId: "submission-1",
	windowId: "window:1",
	name: "牛肉面",
	priceText: null,
	status: "public",
	canEdit: true,
	canDelete: true,
	createdAt: at,
	updatedAt: at,
	deletedAt: null,
	expiresAt: null,
	hiddenAt: null,
	revision: 2,
	windowAvailable: true,
	photo: null,
};
const publicSubmission = {
	submissionId: "submission-1",
	windowId: "window:1",
	name: "牛肉面",
	priceText: null,
	source: "user_submission",
	authorName: "校园用户",
	createdAt: at,
	updatedAt: at,
	canReport: true,
	hasReported: false,
	photo: null,
};
function json(payload: unknown) {
	return new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } });
}

afterEach(() => vi.unstubAllGlobals());

describe("Dining submissions browser facade", () => {
	it("uses independent public and owner routes with encoded cursors and cancellation", async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(json({ items: [publicSubmission], nextCursor: "next" }))
			.mockResolvedValueOnce(json({ submission: publicSubmission }))
			.mockResolvedValueOnce(json({ items: [own], nextCursor: null }))
			.mockResolvedValueOnce(json({ submission: own }));
		vi.stubGlobal("fetch", fetch);
		const signal = new AbortController().signal;
		await expect(
			getDiningSubmissions({ windowId: "window:1", cursor: "a/b+", signal }),
		).resolves.toMatchObject({ items: [publicSubmission] });
		await expect(getDiningSubmission("submission-1")).resolves.toEqual({
			submission: publicSubmission,
		});
		await expect(getMyDiningSubmissions()).resolves.toEqual({ items: [own], nextCursor: null });
		await expect(getMyDiningSubmission("submission-1")).resolves.toEqual({ submission: own });
		expect(fetch).toHaveBeenNthCalledWith(
			1,
			"/api/dining/windows/window%3A1/submissions?limit=20&cursor=a%2Fb%2B",
			expect.objectContaining({ signal, credentials: "same-origin" }),
		);
		expect(fetch).toHaveBeenNthCalledWith(
			3,
			"/api/dining/me/submissions?limit=20",
			expect.anything(),
		);
		expect(fetch).toHaveBeenNthCalledWith(
			4,
			"/api/dining/me/submissions/submission-1",
			expect.anything(),
		);
	});
	it("sends imageless JSON and a caller-owned create key without adding identity or status", async () => {
		const fetch = vi.fn().mockResolvedValue(json({ submission: own }));
		vi.stubGlobal("fetch", fetch);
		await createDiningSubmission({
			windowId: "window:1",
			idempotencyKey: "stable-create-key",
			metadata: { name: " 牛肉面 ", priceText: null, photoAction: "none" },
			photo: null,
		});
		expect(fetch).toHaveBeenCalledWith(
			"/api/dining/windows/window%3A1/submissions",
			expect.objectContaining({
				method: "POST",
				headers: expect.objectContaining({
					"content-type": "application/json",
					"idempotency-key": "stable-create-key",
				}),
				body: JSON.stringify({ name: "牛肉面", priceText: null, photoAction: "none" }),
			}),
		);
	});
	it("sends exactly metadata and photo for replacement and a quoted current revision", async () => {
		const fetch = vi.fn().mockResolvedValue(json({ submission: own }));
		vi.stubGlobal("fetch", fetch);
		const photo = new File(["bytes"], "dish.png", { type: "image/png" });
		await updateDiningSubmission({
			submissionId: "submission-1",
			revision: 2,
			metadata: { name: "牛肉面", priceText: null, photoAction: "replace" },
			photo,
		});
		const request = fetch.mock.calls[0]?.[1] as RequestInit;
		expect(request.method).toBe("PATCH");
		expect(request.headers).toEqual({ accept: "application/json", "if-match": '"2"' });
		expect(request.body).toBeInstanceOf(FormData);
		const form = request.body as FormData;
		expect([...form.keys()]).toEqual(["metadata", "photo"]);
		expect(form.get("photo")).toBe(photo);
		expect(JSON.parse(String(form.get("metadata")))).toEqual({
			name: "牛肉面",
			priceText: null,
			photoAction: "replace",
		});
	});
	it("sends keep and remove as JSON and consumes delete 204", async () => {
		const fetch = vi
			.fn()
			.mockImplementation(async (_path, input: RequestInit) =>
				input.method === "DELETE" ? new Response(null, { status: 204 }) : json({ submission: own }),
			);
		vi.stubGlobal("fetch", fetch);
		for (const photoAction of ["keep", "remove"] as const) {
			await updateDiningSubmission({
				submissionId: "submission-1",
				revision: 2,
				metadata: { name: "牛肉面", priceText: null, photoAction },
				photo: null,
			});
		}
		await expect(
			deleteDiningSubmission({ submissionId: "submission-1", revision: 2 }),
		).resolves.toBeUndefined();
		expect(fetch).toHaveBeenLastCalledWith(
			"/api/dining/me/submissions/submission-1",
			expect.objectContaining({
				method: "DELETE",
				headers: { accept: "application/json", "if-match": '"2"' },
			}),
		);
		expect(JSON.parse(fetch.mock.calls[1]?.[1].body)).toMatchObject({ photoAction: "remove" });
	});
	it("rejects metadata/photo mismatch before fetch and rejects foreign response fields", async () => {
		const fetch = vi
			.fn()
			.mockResolvedValue(json({ submission: { ...publicSubmission, authorId: "private" } }));
		vi.stubGlobal("fetch", fetch);
		await expect(
			createDiningSubmission({
				windowId: "window:1",
				idempotencyKey: "stable-create-key",
				metadata: { name: "牛肉面", priceText: null, photoAction: "replace" },
				photo: null,
			}),
		).rejects.toThrow();
		expect(fetch).not.toHaveBeenCalled();
		await expect(getDiningSubmission("submission-1")).rejects.toThrow();
	});
	it("parses submission review envelopes and reports without changing menu target methods", async () => {
		const review = {
			reviewId: "review-1",
			submissionId: "submission-1",
			anonymous: true,
			authorName: null,
			body: "好吃",
			canDelete: true,
			canReport: false,
			createdAt: at,
			edited: false,
			hasReported: false,
		};
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(json({ review }))
			.mockResolvedValueOnce(json({ items: [review], nextCursor: null }))
			.mockResolvedValueOnce(json({ reportId: "report-1" }));
		vi.stubGlobal("fetch", fetch);
		await expect(
			createDiningSubmissionReview({
				submissionId: "submission-1",
				anonymous: true,
				body: "好吃",
				idempotencyKey: "stable-review-key",
			}),
		).resolves.toEqual(review);
		await expect(getDiningSubmissionReviews({ submissionId: "submission-1" })).resolves.toEqual({
			items: [review],
			nextCursor: null,
		});
		await expect(
			reportDiningSubmission({ submissionId: "submission-1", reason: "privacy", details: null }),
		).resolves.toEqual({ reportId: "report-1" });
		expect(fetch.mock.calls.map(([path]) => path)).toEqual([
			"/api/dining/submissions/submission-1/reviews",
			"/api/dining/submissions/submission-1/reviews?limit=20",
			"/api/dining/submissions/submission-1/reports",
		]);
	});
	it("keeps owner and viewer-sensitive public caches separate and disables anonymous owner reads", () => {
		expect(diningSubmissionsInfiniteQueryOptions("window", "user-1").queryKey).not.toEqual(
			diningSubmissionsInfiniteQueryOptions("window", "user-2").queryKey,
		);
		expect(myDiningSubmissionsInfiniteQueryOptions("user-1").queryKey).not.toEqual(
			myDiningSubmissionsInfiniteQueryOptions("user-2").queryKey,
		);
		expect(myDiningSubmissionsInfiniteQueryOptions(null).enabled).toBe(false);
	});
});
