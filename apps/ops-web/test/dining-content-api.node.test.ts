// @vitest-environment node

import type {
	DiningMenuItemRecord,
	DiningOpsReportRecord,
	DiningOpsReviewRecord,
} from "@campus-agent/dining/domain";
import { describe, expect, it, vi } from "vitest";
import type { DiningContentStore } from "../src/server/dining-content-store";
import { createAllowAllOpsAdmission } from "../src/server/ops-admission";
import { createFixtureOpsStatusStore } from "../src/server/ops-status-store";
import { createTestOpsApp } from "./helpers/ops-app";

const NOW = "2026-07-24T08:00:00.000Z";
const menuItem: DiningMenuItemRecord = {
	archivedAt: null,
	createdAt: NOW,
	createdBy: "ops@example.test",
	menuItemId: "dmi_1",
	name: "牛肉面",
	priceText: "12 元",
	sortOrder: 0,
	updatedAt: NOW,
	updatedBy: "ops@example.test",
	windowId: "hall:floor:window-01",
};
const review: DiningOpsReviewRecord = {
	anonymous: true,
	authorDisplayName: "张同学",
	authorId: "user_1",
	authorKind: "member",
	body: "味道不错。",
	createdAt: NOW,
	deletedAt: null,
	editCount: 0,
	editedAt: null,
	hiddenAt: null,
	hiddenBy: null,
	menuItemId: menuItem.menuItemId,
	menuItemName: menuItem.name,
	reviewId: "drv_1",
	updatedAt: NOW,
	updatedBy: "user_1",
	windowId: menuItem.windowId,
};
const report: DiningOpsReportRecord = {
	createdAt: NOW,
	details: "包含联系方式",
	reason: "privacy",
	reportId: "drp_1",
	reporterUserId: "user_2",
	resolution: null,
	resolvedAt: null,
	resolvedBy: null,
	review,
};

function contentStore(): DiningContentStore {
	return {
		archiveMenuItem: vi.fn(async () => ({ ...menuItem, archivedAt: NOW })),
		createMenuItem: vi.fn(async () => menuItem),
		createReview: vi.fn(async () => review),
		deleteOperatorReview: vi.fn(async () => undefined),
		getReview: vi.fn(async () => ({ edits: [], review })),
		listMenuItems: vi.fn(async () => [menuItem]),
		listReports: vi.fn(async () => ({ items: [report], nextCursor: null })),
		listReviews: vi.fn(async () => ({ items: [review], nextCursor: null })),
		moveMenuItem: vi.fn(async () => menuItem),
		reorderMenuItems: vi.fn(async () => [menuItem]),
		resolveReports: vi.fn(async () => undefined),
		restoreMenuItem: vi.fn(async () => menuItem),
		setReviewVisibility: vi.fn(async () => review),
		updateMenuItem: vi.fn(async () => menuItem),
		updateReview: vi.fn(async () => review),
		verifyReadiness: vi.fn(async () => undefined),
	};
}

function createTestApp(diningContentStore: DiningContentStore) {
	return createTestOpsApp({
		admission: createAllowAllOpsAdmission(),
		diningContentStore,
		env: {
			ACCESS_POLICY_AUD: "ops-web-test-audience",
			ACCESS_TEAM_DOMAIN: "https://team-ops-web.cloudflareaccess.com",
			OPS_WEB_PUBLIC_ORIGIN: "https://ops.example.test",
		},
		store: createFixtureOpsStatusStore(),
	});
}

const writeHeaders = {
	"content-type": "application/json",
	origin: "https://ops.example.test",
};

describe("Ops Web Dining content API", () => {
	it("lists and creates menu items with the admitted operator", async () => {
		const store = contentStore();
		const app = createTestApp(store);

		const listed = await app.request("/api/ops/dining/menu-items");
		const created = await app.request("/api/ops/dining/menu-items", {
			body: JSON.stringify({ name: "牛肉面", priceText: "12 元", windowId: menuItem.windowId }),
			headers: writeHeaders,
			method: "POST",
		});

		expect(listed.status).toBe(200);
		expect(created.status).toBe(201);
		expect(store.createMenuItem).toHaveBeenCalledWith(
			expect.objectContaining({ principalId: "ops@example.test" }),
			{ name: "牛肉面", priceText: "12 元", windowId: menuItem.windowId },
		);
	});

	it("supports menu edits, moves, ordering and archival without accepting cross-origin writes", async () => {
		const store = contentStore();
		const app = createTestApp(store);

		const rejected = await app.request(`/api/ops/dining/menu-items/${menuItem.menuItemId}`, {
			body: JSON.stringify({ name: "牛肉拉面" }),
			headers: { ...writeHeaders, origin: "https://other.example.test" },
			method: "PATCH",
		});
		const updated = await app.request(`/api/ops/dining/menu-items/${menuItem.menuItemId}`, {
			body: JSON.stringify({ name: "牛肉拉面" }),
			headers: writeHeaders,
			method: "PATCH",
		});
		const moved = await app.request(`/api/ops/dining/menu-items/${menuItem.menuItemId}/move`, {
			body: JSON.stringify({ windowId: "hall:floor:window-02" }),
			headers: writeHeaders,
			method: "POST",
		});
		const ordered = await app.request(`/api/ops/dining/windows/${menuItem.windowId}/menu-order`, {
			body: JSON.stringify({ menuItemIds: [menuItem.menuItemId] }),
			headers: writeHeaders,
			method: "PUT",
		});
		const archived = await app.request(
			`/api/ops/dining/menu-items/${menuItem.menuItemId}/archive`,
			{ headers: { origin: writeHeaders.origin }, method: "POST" },
		);

		expect(rejected.status).toBe(403);
		expect(updated.status).toBe(200);
		expect(moved.status).toBe(200);
		expect(ordered.status).toBe(200);
		expect(archived.status).toBe(200);
		expect(store.updateMenuItem).toHaveBeenCalledWith(expect.any(Object), menuItem.menuItemId, {
			name: "牛肉拉面",
		});
	});

	it("lists, creates, edits, hides and deletes operator reviews", async () => {
		const store = contentStore();
		const app = createTestApp(store);

		const listed = await app.request(
			"/api/ops/dining/reviews?limit=20&visibility=visible&q=%E7%89%9B%E8%82%89",
		);
		const created = await app.request(
			`/api/ops/dining/reviews?menu_item_id=${menuItem.menuItemId}`,
			{
				body: JSON.stringify({ anonymous: true, body: "味道不错。" }),
				headers: { ...writeHeaders, "idempotency-key": "ops-review-key-1" },
				method: "POST",
			},
		);
		const updated = await app.request(`/api/ops/dining/reviews/${review.reviewId}`, {
			body: JSON.stringify({ body: "修改后的评价。" }),
			headers: writeHeaders,
			method: "PATCH",
		});
		const hidden = await app.request(`/api/ops/dining/reviews/${review.reviewId}/visibility`, {
			body: JSON.stringify({ visible: false }),
			headers: writeHeaders,
			method: "PUT",
		});
		const removed = await app.request(`/api/ops/dining/reviews/${review.reviewId}`, {
			headers: { origin: writeHeaders.origin },
			method: "DELETE",
		});

		expect(listed.status).toBe(200);
		expect(created.status).toBe(201);
		expect(updated.status).toBe(200);
		expect(hidden.status).toBe(200);
		expect(removed.status).toBe(204);
		expect(store.listReviews).toHaveBeenCalledWith({
			cursor: undefined,
			limit: 20,
			menuItemId: undefined,
			q: "牛肉",
			visibility: "visible",
			windowId: undefined,
		});
		expect(store.createReview).toHaveBeenCalledWith(
			expect.objectContaining({ principalId: "ops@example.test" }),
			expect.objectContaining({ idempotencyKey: "ops-review-key-1" }),
		);
	});

	it("lists reports and resolves all pending reports for one review", async () => {
		const store = contentStore();
		const app = createTestApp(store);

		const listed = await app.request("/api/ops/dining/reports?status=pending&limit=20");
		const resolved = await app.request(
			`/api/ops/dining/reviews/${review.reviewId}/reports/resolve`,
			{
				body: JSON.stringify({ resolution: "hide" }),
				headers: writeHeaders,
				method: "POST",
			},
		);

		expect(listed.status).toBe(200);
		expect(resolved.status).toBe(204);
		expect(store.listReports).toHaveBeenCalledWith({
			cursor: undefined,
			limit: 20,
			status: "pending",
		});
		expect(store.resolveReports).toHaveBeenCalledWith(
			expect.objectContaining({ principalId: "ops@example.test" }),
			review.reviewId,
			"hide",
		);
	});
});
