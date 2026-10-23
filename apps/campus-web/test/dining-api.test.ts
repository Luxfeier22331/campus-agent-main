import { afterEach, describe, expect, it, vi } from "vitest";

import {
	createDiningReview,
	getDiningMap,
	getDiningReviews,
	getDiningWindowMenu,
} from "../src/features/dining/api";

describe("Dining map API", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("reads the complete published map from the single public endpoint", async () => {
		const requestedPaths: Array<RequestInfo | URL> = [];
		const payload = {
			halls: [],
			releaseId: "dining_release:test",
			updatedAt: "2026-07-24T08:00:00.000Z",
		};
		const fetchMock = vi.fn((input: RequestInfo | URL) => {
			requestedPaths.push(input);
			return Promise.resolve(
				new Response(JSON.stringify(payload), {
					headers: { "content-type": "application/json" },
				}),
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		await expect(getDiningMap()).resolves.toEqual(payload);
		expect(fetchMock).toHaveBeenCalledOnce();
		expect(requestedPaths[0]).toBe("/api/dining");
	});

	it("rejects responses that do not match the published map contract", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(() =>
				Promise.resolve(
					new Response(JSON.stringify({ halls: [] }), {
						headers: { "content-type": "application/json" },
					}),
				),
			),
		);

		await expect(getDiningMap()).rejects.toThrow();
	});

	it("validates menu and review responses", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						items: [{ menuItemId: "dmi_1", name: "牛肉面", priceText: "12 元", sortOrder: 0 }],
						windowId: "hall:floor:window-01",
					}),
					{ headers: { "content-type": "application/json" } },
				),
			)
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ items: [], nextCursor: null }), {
					headers: { "content-type": "application/json" },
				}),
			);
		vi.stubGlobal("fetch", fetchMock);

		await expect(getDiningWindowMenu("hall:floor:window-01")).resolves.toMatchObject({
			items: [{ name: "牛肉面" }],
		});
		await expect(getDiningReviews({ menuItemId: "dmi_1" })).resolves.toEqual({
			items: [],
			nextCursor: null,
		});
		expect(fetchMock).toHaveBeenNthCalledWith(
			1,
			"/api/dining/windows/hall%3Afloor%3Awindow-01/menu",
			expect.any(Object),
		);
	});

	it("sends the caller-owned idempotency key when creating a review", async () => {
		const response = {
			anonymous: true,
			authorName: null,
			body: "味道不错。",
			canDelete: true,
			canReport: false,
			createdAt: "2026-07-24T08:00:00.000Z",
			edited: false,
			hasReported: false,
			menuItemId: "dmi_1",
			reviewId: "drv_1",
		};
		const fetchMock = vi.fn(() =>
			Promise.resolve(
				new Response(JSON.stringify(response), {
					headers: { "content-type": "application/json" },
					status: 201,
				}),
			),
		);
		vi.stubGlobal("fetch", fetchMock);

		await createDiningReview({
			anonymous: true,
			body: "味道不错。",
			idempotencyKey: "stable-review-key",
			menuItemId: "dmi_1",
		});

		expect(fetchMock).toHaveBeenCalledWith(
			"/api/dining/menu-items/dmi_1/reviews",
			expect.objectContaining({
				headers: expect.objectContaining({ "idempotency-key": "stable-review-key" }),
				method: "POST",
			}),
		);
	});
});
