// @vitest-environment node

import { DINING_BOOTSTRAP_FLOORPLANS } from "@campus-agent/dining/floorplans";
import {
	buildDiningMapResponse,
	diningMapBundleFingerprint,
	renderDiningMapAssets,
} from "@campus-agent/dining/publisher";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import type { Env } from "../../app-api/src/config";
import { createPgDiningContentService } from "../../app-api/src/modules/dining/content-store";
import { applyOpsWebDatabaseGrants } from "../ops/db/ops-web-database";
import { createPgDiningContentStore } from "../src/server/dining-content-store";

const postgres = inject("opsWebPostgres");
const databaseEnv = {
	DEPLOYMENT_ENVIRONMENT: "local",
	OPS_WEB_DATABASE_SSLMODE: "disable",
	OPS_WEB_DATABASE_URL: postgres.opsWebConnectionString,
	OPS_WEB_SCHEMA_DATABASE_SSLMODE: "disable",
	OPS_WEB_SCHEMA_DATABASE_URL: postgres.managementConnectionString,
} as const;
const operator = { displayName: "值班员", principalId: "ops:1" };
const windowIds = DINING_BOOTSTRAP_FLOORPLANS.layouts.flatMap((layout) =>
	layout.windows.map((window) => `${layout.hallId}:${layout.floorId}:${window.anchorId}`),
);
const primaryWindowId = windowIds[0];
const secondaryWindowId = windowIds[1];
if (!(primaryWindowId && secondaryWindowId)) {
	throw new Error("Dining integration fixture needs at least two windows.");
}
const fingerprint = diningMapBundleFingerprint(DINING_BOOTSTRAP_FLOORPLANS);
const publicMap = buildDiningMapResponse({
	assets: renderDiningMapAssets(DINING_BOOTSTRAP_FLOORPLANS),
	bundle: DINING_BOOTSTRAP_FLOORPLANS,
	releaseId: "release-current",
	updatedAt: "2026-07-24T08:00:00.000Z",
});

describe("Dining content PostgreSQL stores", () => {
	let managementPool: Pool;
	let opsPool: Pool;
	let tick = 0;

	beforeAll(async () => {
		await applyOpsWebDatabaseGrants(databaseEnv);
		managementPool = new Pool({ connectionString: postgres.managementConnectionString, max: 6 });
		opsPool = new Pool({ connectionString: postgres.opsWebConnectionString, max: 4 });
	});

	beforeEach(async () => {
		tick = 0;
		await managementPool.query(`
			truncate dining.review_edits, dining.review_reports, dining.reviews, dining.menu_items;
			delete from dining.map_publication;
			delete from dining.map_releases;
			delete from dining.map_draft;
		`);
		await managementPool.query(
			`insert into dining.map_draft
			 (scope, bundle_json, fingerprint, revision, updated_at, updated_by)
			 values ('global', $1, $2, 1, $3, 'bootstrap')`,
			[DINING_BOOTSTRAP_FLOORPLANS, fingerprint, "2026-07-24T08:00:00.000Z"],
		);
		await managementPool.query(
			`insert into dining.map_releases
			 (release_id, snapshot_hash, draft_revision, kind, restored_from_release_id,
			  bundle_json, public_payload_json, created_at, created_by)
			 values ('release-current', $1, 1, 'publish', null, $2, $3, $4, 'bootstrap')`,
			[fingerprint, DINING_BOOTSTRAP_FLOORPLANS, publicMap, "2026-07-24T08:00:00.000Z"],
		);
		await managementPool.query(
			`insert into dining.map_publication (scope, release_id, updated_at, updated_by)
			 values ('global', 'release-current', $1, 'bootstrap')`,
			["2026-07-24T08:00:00.000Z"],
		);
	});

	afterAll(async () => {
		await Promise.all([managementPool.end(), opsPool.end()]);
	});

	function now() {
		return new Date(Date.parse("2026-07-24T08:00:00.000Z") + tick++ * 1_000);
	}

	function createAppApiService() {
		return createPgDiningContentService(
			{
				APP_API_DATABASE_SSLMODE: "disable",
				APP_API_DB_FRESH: { connectionString: postgres.appApiConnectionString },
				APP_API_ENVIRONMENT: "test",
			} as Env,
			{ now },
		);
	}

	it("maintains menu ordering, movement and archival against stable map windows", async () => {
		const store = createPgDiningContentStore({ now, pool: opsPool });
		const first = await store.createMenuItem(operator, {
			name: "牛肉面",
			priceText: "12 元",
			windowId: primaryWindowId,
		});
		const second = await store.createMenuItem(operator, {
			name: "鸡肉面",
			priceText: null,
			windowId: primaryWindowId,
		});

		await store.reorderMenuItems(operator, primaryWindowId, [second.menuItemId, first.menuItemId]);
		const updated = await store.updateMenuItem(operator, first.menuItemId, {
			name: "红烧牛肉面",
			priceText: "13 元",
		});
		const moved = await store.moveMenuItem(operator, second.menuItemId, secondaryWindowId);
		const archived = await store.archiveMenuItem(operator, first.menuItemId);
		const restored = await store.restoreMenuItem(operator, first.menuItemId);

		expect(updated).toMatchObject({ name: "红烧牛肉面", priceText: "13 元" });
		expect(moved.windowId).toBe(secondaryWindowId);
		expect(archived.archivedAt).not.toBeNull();
		expect(restored.archivedAt).toBeNull();
		expect((await store.listMenuItems()).map((item) => item.menuItemId)).toEqual(
			expect.arrayContaining([first.menuItemId, second.menuItemId]),
		);
	});

	it("enforces member daily limits under concurrency and keeps deleted reviews in the count", async () => {
		const opsStore = createPgDiningContentStore({ now, pool: opsPool });
		const item = await opsStore.createMenuItem(operator, {
			name: "牛肉面",
			priceText: "12 元",
			windowId: primaryWindowId,
		});
		const service = createAppApiService();
		const member = { displayName: "张同学", kind: "member" as const, principalId: "user_1" };
		const first = await service.createReview({
			actor: member,
			anonymous: true,
			body: "第一条",
			idempotencyKey: "member-review-key-1",
			menuItemId: item.menuItemId,
		});
		const replay = await service.createReview({
			actor: member,
			anonymous: true,
			body: "第一条",
			idempotencyKey: "member-review-key-1",
			menuItemId: item.menuItemId,
		});
		await service.createReview({
			actor: member,
			anonymous: false,
			body: "第二条",
			idempotencyKey: "member-review-key-2",
			menuItemId: item.menuItemId,
		});
		await service.createReview({
			actor: member,
			anonymous: false,
			body: "第三条",
			idempotencyKey: "member-review-key-3",
			menuItemId: item.menuItemId,
		});

		expect(replay.reviewId).toBe(first.reviewId);
		await expect(
			service.createReview({
				actor: member,
				anonymous: false,
				body: "第四条",
				idempotencyKey: "member-review-key-4",
				menuItemId: item.menuItemId,
			}),
		).rejects.toMatchObject({ code: "dining_review_daily_limit" });

		await expect(
			service.reportReview({
				details: null,
				reason: "other",
				reviewId: first.reviewId,
				userId: member.principalId,
			}),
		).rejects.toMatchObject({ code: "dining_review_self_report_forbidden" });
		const reports = await Promise.all([
			service.reportReview({
				details: "隐私问题",
				reason: "privacy",
				reviewId: first.reviewId,
				userId: "user_2",
			}),
			service.reportReview({
				details: "隐私问题",
				reason: "privacy",
				reviewId: first.reviewId,
				userId: "user_2",
			}),
		]);
		expect(reports[1]?.reportId).toBe(reports[0]?.reportId);

		const owned = await service.listReviews({
			limit: 50,
			menuItemId: item.menuItemId,
			viewerUserId: member.principalId,
		});
		expect(owned.items.find((review) => review.reviewId === first.reviewId)).toMatchObject({
			authorName: null,
			canDelete: true,
		});
		await service.deleteOwnReview({ reviewId: first.reviewId, userId: member.principalId });
		await expect(
			service.createReview({
				actor: member,
				anonymous: false,
				body: "删除后仍不能新增",
				idempotencyKey: "member-review-key-4",
				menuItemId: item.menuItemId,
			}),
		).rejects.toMatchObject({ code: "dining_review_daily_limit" });

		const concurrentMember = {
			displayName: "李同学",
			kind: "member" as const,
			principalId: "user_concurrent",
		};
		const concurrent = await Promise.allSettled(
			[1, 2, 3, 4].map((index) =>
				createAppApiService().createReview({
					actor: concurrentMember,
					anonymous: false,
					body: `并发评价 ${index}`,
					idempotencyKey: `concurrent-review-key-${index}`,
					menuItemId: item.menuItemId,
				}),
			),
		);
		expect(concurrent.filter((result) => result.status === "fulfilled")).toHaveLength(3);
		expect(concurrent.filter((result) => result.status === "rejected")).toHaveLength(1);
	});

	it("records every Ops edit and resolves all reports for a review together", async () => {
		const store = createPgDiningContentStore({ now, pool: opsPool });
		const item = await store.createMenuItem(operator, {
			name: "牛肉面",
			priceText: null,
			windowId: primaryWindowId,
		});
		const review = await store.createReview(operator, {
			anonymous: false,
			body: "原始正文",
			idempotencyKey: "ops-review-key-1",
			menuItemId: item.menuItemId,
		});

		await store.updateReview(operator, review.reviewId, "修改后的正文");
		const detail = await store.getReview(review.reviewId);
		expect(detail.review).toMatchObject({ body: "修改后的正文", editCount: 1 });
		expect(detail.edits).toEqual([
			expect.objectContaining({ nextBody: "修改后的正文", previousBody: "原始正文" }),
		]);

		await managementPool.query(
			`insert into dining.review_reports
			 (report_id, review_id, reporter_user_id, reason, details, created_at)
			 values
			 ('drp_1', $1, 'user_1', 'spam', null, $2),
			 ('drp_2', $1, 'user_2', 'privacy', '包含联系方式', $3)`,
			[review.reviewId, now(), now()],
		);
		const firstPage = await store.listReports({ limit: 1, status: "pending" });
		const secondPage = await store.listReports({
			cursor: firstPage.nextCursor ?? undefined,
			limit: 1,
			status: "pending",
		});
		expect(firstPage.items).toHaveLength(1);
		expect(secondPage.items).toHaveLength(1);
		expect(secondPage.items[0]?.reportId).not.toBe(firstPage.items[0]?.reportId);

		await store.resolveReports(operator, review.reviewId, "hide");
		expect((await store.listReports({ limit: 10, status: "pending" })).items).toHaveLength(0);
		expect((await store.listReports({ limit: 10, status: "resolved" })).items).toHaveLength(2);
		expect((await store.getReview(review.reviewId)).review.hiddenAt).not.toBeNull();
	});
});
