// @vitest-environment node

import type {
	DiningMenuItemRecord,
	DiningOpsContentReportRecord,
	DiningOpsContentReviewRecord,
} from "@campus-agent/dining/domain";
import { describe, expect, it, vi } from "vitest";
import type { DiningMenuStore, DiningReviewStore } from "../src/server/dining-store-contract";
import { createAllowAllOpsAdmission } from "../src/server/ops-admission";
import { createFixtureOpsStatusStore } from "../src/server/ops-status/store/fixture.ts";
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
const review: DiningOpsContentReviewRecord = {
	contentRevision: 1,
	targetKind: "menu_item",
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
const report: DiningOpsContentReportRecord = {
	createdAt: NOW,
	details: "包含联系方式",
	reason: "privacy",
	reportId: "drp_1",
	reporterUserId: "user_2",
	resolution: null,
	resolvedAt: null,
	resolvedBy: null,
	target: {
		kind: "review",
		current: review,
		targetRevision: 1,
		reported: { replayable: true, body: "味道不错。" },
	},
};

type TestDiningContentStore = DiningMenuStore & DiningReviewStore;

function contentStore(): TestDiningContentStore {
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

function createTestApp(diningContentStore: TestDiningContentStore) {
	return createTestOpsApp({
		admission: createAllowAllOpsAdmission(),
		diningMenuStore: diningContentStore,
		diningReviewStore: diningContentStore,
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

	it("accepts explicit submission targets and rejects conflicting filters", async () => {
		const store = contentStore();
		const app = createTestApp(store);
		const reviews = await app.request(
			"/api/ops/dining/reviews?target_type=submission&submission_id=dsb_1",
		);
		const reports = await app.request(
			"/api/ops/dining/reports?target_type=review&submission_id=dsb_1",
		);
		expect(reviews.status).toBe(200);
		expect(reports.status).toBe(200);
		expect(store.listReviews).toHaveBeenCalledWith({
			limit: 50,
			targetType: "submission",
			submissionId: "dsb_1",
		});
		expect(store.listReports).toHaveBeenCalledWith({
			limit: 50,
			status: "pending",
			targetType: "review",
			submissionId: "dsb_1",
		});
		for (const path of [
			"reviews?menu_item_id=dmi_1&submission_id=dsb_1",
			"reviews?target_type=menu_item&submission_id=dsb_1",
			"reviews?target_type=submission&menu_item_id=dmi_1",
			"reports?menu_item_id=dmi_1&submission_id=dsb_1",
			"reports?target_type=submission&menu_item_id=dmi_1",
		]) {
			expect((await app.request(`/api/ops/dining/${path}`)).status).toBe(400);
		}
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
