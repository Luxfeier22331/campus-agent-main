// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import type { ResolvedAppPrincipal } from "../src/modules/auth";
import type { DiningContentService } from "../src/modules/dining";

const env = {
	DEPLOYMENT_ENVIRONMENT: "test" as const,
	AUTH_SHELL_ORIGIN: "https://campus.muc.wiki",
	BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
	APP_API_DB: { connectionString: "postgres://postgres:secret@example.com:5432/campus_agent" },
};

const review = {
	anonymous: false,
	authorName: "张同学",
	body: "味道不错。",
	canDelete: true,
	canReport: false,
	createdAt: "2026-07-24T08:00:00.000Z",
	edited: false,
	hasReported: false,
	menuItemId: "dmi_1",
	reviewId: "drv_1",
};

function principal(): ResolvedAppPrincipal {
	return {
		actor: {
			departments: [],
			principalId: "user_1",
			principalType: "campus_member",
			roles: ["campus_member"],
			userId: "user_1",
		},
		permissions: { chat: true },
		principal: {
			displayName: "张同学",
			email: "student@muc.edu.cn",
			principalId: "user_1",
			type: "campus_member",
		},
		session: { expiresAt: "2026-07-25T08:00:00.000Z", sessionId: "session_1" },
	};
}

function service(): DiningContentService {
	return {
		createReview: vi.fn(async () => review),
		deleteOwnReview: vi.fn(async () => undefined),
		getWindowMenu: vi.fn(async (windowId) => ({
			items: [{ menuItemId: "dmi_1", name: "牛肉面", priceText: "12 元", sortOrder: 0 }],
			windowId,
		})),
		listReviews: vi.fn(async () => ({ items: [review], nextCursor: null })),
		reportReview: vi.fn(async () => ({ reportId: "drp_1" })),
	};
}

describe("Dining content routes", () => {
	it("serves a public window menu with a sixty-second shared cache boundary", async () => {
		const diningContentService = service();
		const app = createApp(env, { diningContentService, getPrincipal: vi.fn(async () => null) });

		const response = await app.fetch(
			new Request("https://app-api.internal/api/dining/windows/hall:floor:window-01/menu"),
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("public, max-age=30, s-maxage=60");
		await expect(response.json()).resolves.toMatchObject({
			items: [{ menuItemId: "dmi_1", name: "牛肉面", priceText: "12 元" }],
		});
		expect(diningContentService.getWindowMenu).toHaveBeenCalledWith("hall:floor:window-01");
	});

	it("lists reviews publicly and adds viewer capabilities only for the resolved principal", async () => {
		const diningContentService = service();
		const anonymousApp = createApp(env, {
			diningContentService,
			getPrincipal: vi.fn(async () => null),
		});
		const memberApp = createApp(env, {
			diningContentService,
			getPrincipal: vi.fn(async () => principal()),
		});

		expect(
			(
				await anonymousApp.fetch(
					new Request("https://app-api.internal/api/dining/menu-items/dmi_1/reviews?limit=20"),
				)
			).status,
		).toBe(200);
		expect(
			(
				await memberApp.fetch(
					new Request("https://app-api.internal/api/dining/menu-items/dmi_1/reviews"),
				)
			).status,
		).toBe(200);
		expect(diningContentService.listReviews).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({ menuItemId: "dmi_1", viewerUserId: null }),
		);
		expect(diningContentService.listReviews).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ menuItemId: "dmi_1", viewerUserId: "user_1" }),
		);
	});

	it("requires a member session and stable idempotency key when creating a review", async () => {
		const diningContentService = service();
		const memberApp = createApp(env, {
			diningContentService,
			getPrincipal: vi.fn(async () => principal()),
		});
		const anonymousApp = createApp(env, {
			diningContentService,
			getPrincipal: vi.fn(async () => null),
		});
		const body = JSON.stringify({ anonymous: true, body: "  味道不错。  " });

		const unauthorized = await anonymousApp.fetch(
			new Request("https://app-api.internal/api/dining/menu-items/dmi_1/reviews", {
				body,
				headers: { "content-type": "application/json", "idempotency-key": "review-key-1" },
				method: "POST",
			}),
		);
		const created = await memberApp.fetch(
			new Request("https://app-api.internal/api/dining/menu-items/dmi_1/reviews", {
				body,
				headers: { "content-type": "application/json", "idempotency-key": "review-key-1" },
				method: "POST",
			}),
		);

		expect(unauthorized.status).toBe(401);
		expect(created.status).toBe(201);
		expect(diningContentService.createReview).toHaveBeenCalledWith({
			actor: { displayName: "张同学", kind: "member", principalId: "user_1" },
			anonymous: true,
			body: "味道不错。",
			idempotencyKey: "review-key-1",
			menuItemId: "dmi_1",
		});
	});

	it("passes member ownership to deletion and reporting operations", async () => {
		const diningContentService = service();
		const app = createApp(env, {
			diningContentService,
			getPrincipal: vi.fn(async () => principal()),
		});

		const removed = await app.fetch(
			new Request("https://app-api.internal/api/dining/reviews/drv_1", { method: "DELETE" }),
		);
		const reported = await app.fetch(
			new Request("https://app-api.internal/api/dining/reviews/drv_2/reports", {
				body: JSON.stringify({ details: "  包含个人联系方式  ", reason: "privacy" }),
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
		);

		expect(removed.status).toBe(204);
		expect(reported.status).toBe(201);
		expect(diningContentService.deleteOwnReview).toHaveBeenCalledWith({
			reviewId: "drv_1",
			userId: "user_1",
		});
		expect(diningContentService.reportReview).toHaveBeenCalledWith({
			details: "包含个人联系方式",
			reason: "privacy",
			reviewId: "drv_2",
			userId: "user_1",
		});
	});
});
