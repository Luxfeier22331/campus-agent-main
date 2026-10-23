// @vitest-environment node

import {
	DiningOpsContentReportPageSchema,
	DiningOpsContentReviewDetailSchema,
	DiningOpsContentReviewPageSchema,
} from "@campus-agent/dining/domain";
import { DINING_BOOTSTRAP_FLOORPLANS } from "@campus-agent/dining/floorplans";
import {
	buildDiningMapResponse,
	diningMapBundleFingerprint,
	renderDiningMapAssets,
} from "@campus-agent/dining/publisher";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { createDiningContentServiceTestAdapter } from "../../app-api/test-support/dining";
import { applyOpsWebDatabaseGrants } from "../ops/db/ops-web-database";
import { createPgDiningMenuStore } from "../src/server/dining-menu-store";
import { createPgDiningReviewStore } from "../src/server/dining-review-store";

const postgres = inject("opsWebPostgres");
const databaseEnv = {
	DEPLOYMENT_ENVIRONMENT: "local",
	OPS_WEB_DATABASE_SSLMODE: "disable",
	OPS_WEB_DATABASE_URL: postgres.opsWebConnectionString,
	OPS_WEB_SCHEMA_DATABASE_SSLMODE: "disable",
	OPS_WEB_SCHEMA_DATABASE_URL: postgres.managementConnectionString,
} as const;
const operator = { displayName: "值班员", principalId: "ops:1" };

function createPgDiningStores(input: Parameters<typeof createPgDiningMenuStore>[0]) {
	return {
		menu: createPgDiningMenuStore(input),
		reviews: createPgDiningReviewStore(input),
	};
}
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
	let appApiPool: Pool;
	let managementPool: Pool;
	let opsPool: Pool;
	let tick = 0;

	beforeAll(async () => {
		await applyOpsWebDatabaseGrants(databaseEnv);
		appApiPool = new Pool({ connectionString: postgres.appApiConnectionString, max: 4 });
		managementPool = new Pool({ connectionString: postgres.managementConnectionString, max: 6 });
		opsPool = new Pool({ connectionString: postgres.opsWebConnectionString, max: 4 });
	});

	beforeEach(async () => {
		tick = 0;
		await managementPool.query(`
			truncate dining.review_edits, dining.review_reports, dining.reviews, dining.menu_items, dining.submission_reports, dining.submission_edits, dining.submission_photos, dining.submissions;
			delete from dining.map_publication;
			delete from dining.map_releases;
			delete from dining.map_draft;
		`);
		for (const id of ["user_1", "user_2", "user_concurrent", "author", "reader"]) {
			await managementPool.query(
				`insert into app_auth."user" (id, name, email, "createdAt", "updatedAt") values ($1, $1, $2, $3, $3) on conflict (id) do nothing`,
				[id, `${id}@muc.edu.cn`, now()],
			);
		}
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
		await Promise.all([appApiPool.end(), managementPool.end(), opsPool.end()]);
	});

	function now() {
		return new Date(Date.parse("2026-07-24T08:00:00.000Z") + tick++ * 1_000);
	}

	function createAppApiService() {
		return createDiningContentServiceTestAdapter({
			now,
			pool: appApiPool,
		});
	}

	it("maintains menu ordering, movement and archival against stable map windows", async () => {
		const store = createPgDiningStores({ now, pool: opsPool }).menu;
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
		const opsStore = createPgDiningStores({ now, pool: opsPool }).menu;
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
		const stores = createPgDiningStores({ now, pool: opsPool });
		const item = await stores.menu.createMenuItem(operator, {
			name: "牛肉面",
			priceText: null,
			windowId: primaryWindowId,
		});
		const review = await stores.reviews.createReview(operator, {
			anonymous: false,
			body: "原始正文",
			idempotencyKey: "ops-review-key-1",
			menuItemId: item.menuItemId,
		});

		await stores.reviews.updateReview(operator, review.reviewId, "修改后的正文");
		const detail = await stores.reviews.getReview(review.reviewId);
		expect(detail.review).toMatchObject({ body: "修改后的正文", editCount: 1, contentRevision: 2 });
		expect(DiningOpsContentReviewDetailSchema.safeParse(detail).success).toBe(true);
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
		const firstPage = await stores.reviews.listReports({ limit: 1, status: "pending" });
		const secondPage = await stores.reviews.listReports({
			...(firstPage.nextCursor ? { cursor: firstPage.nextCursor } : {}),
			limit: 1,
			status: "pending",
		});
		expect(firstPage.items).toHaveLength(1);
		expect(secondPage.items).toHaveLength(1);
		expect(secondPage.items[0]?.reportId).not.toBe(firstPage.items[0]?.reportId);

		await stores.reviews.resolveReports(operator, review.reviewId, "hide");
		expect((await stores.reviews.listReports({ limit: 10, status: "pending" })).items).toHaveLength(
			0,
		);
		expect(
			(await stores.reviews.listReports({ limit: 10, status: "resolved" })).items,
		).toHaveLength(2);
		expect((await stores.reviews.getReview(review.reviewId)).review.hiddenAt).not.toBeNull();
	});

	async function seedSubmission(id = "dsb_1") {
		await managementPool.query(
			`insert into dining.submissions
			(submission_id, author_id, author_display_name, window_id, name, price_text, status, revision, content_revision, created_at, updated_at, created_submission_date)
			values ($1, 'author', '投稿同学', $2, '投稿牛肉面', '12 元', 'public', 1, 1, $3, $3, '2026-07-24')`,
			[id, primaryWindowId, now()],
		);
		return id;
	}

	async function seedReview(submissionId: string, id = "drv_submission") {
		await managementPool.query(
			`insert into dining.reviews
			(review_id, submission_id, author_kind, author_id, author_display_name, anonymous, body, idempotency_key, submission_date, created_at, updated_at, updated_by)
			values ($1, $2, 'member', 'reader', '评价同学', false, '原始投稿评价', $1, '2026-07-24', $3, $3, 'reader')`,
			[id, submissionId, now()],
		);
		return id;
	}

	it("lists both review targets, supports exclusive filters and preserves student deletion restrictions", async () => {
		const stores = createPgDiningStores({ now, pool: opsPool });
		const submissionId = await seedSubmission();
		const reviewId = await seedReview(submissionId);
		const item = await stores.menu.createMenuItem(operator, {
			name: "正式菜单",
			priceText: null,
			windowId: primaryWindowId,
		});
		await stores.reviews.createReview(operator, {
			anonymous: false,
			body: "菜单评价",
			idempotencyKey: "menu-review",
			menuItemId: item.menuItemId,
		});
		const all = await stores.reviews.listReviews({ limit: 50 });
		expect(DiningOpsContentReviewPageSchema.safeParse(all).success).toBe(true);
		expect(all.items.map((review) => review.targetKind).sort()).toEqual([
			"menu_item",
			"submission",
		]);
		expect(
			(await stores.reviews.listReviews({ limit: 50, submissionId, targetType: "submission" }))
				.items,
		).toMatchObject([{ reviewId, targetKind: "submission", submissionName: "投稿牛肉面" }]);
		expect(
			(await stores.reviews.listReviews({ limit: 50, windowId: primaryWindowId })).items,
		).toHaveLength(2);
		await expect(
			stores.reviews.listReviews({ limit: 50, submissionId, menuItemId: item.menuItemId }),
		).rejects.toMatchObject({ name: "DiningStoreValidationError" });
		await expect(stores.reviews.deleteOperatorReview(operator, reviewId)).rejects.toMatchObject({
			name: "DiningStoreNotFoundError",
		});
		await managementPool.query(
			"update dining.submissions set status = 'hidden', hidden_at = $1, hidden_by = 'ops:1' where submission_id = $2",
			[now(), submissionId],
		);
		expect((await stores.reviews.getReview(reviewId)).review.hiddenAt).toBeNull();
		await managementPool.query(
			"update dining.submissions set status = 'purged', purged_at = $1, name = null, window_id = null, author_id = null, author_display_name = null where submission_id = $2",
			[now(), submissionId],
		);
		expect((await stores.reviews.getReview(reviewId)).review).toMatchObject({
			targetKind: "submission",
			submissionName: null,
			windowId: null,
			body: "原始投稿评价",
		});
		const expiredStore = createPgDiningReviewStore({
			pool: opsPool,
			now: () => new Date("2026-08-25T08:00:00Z"),
		});
		expect((await expiredStore.getReview(reviewId)).review.body).toBeNull();
		await expect(
			expiredStore.updateReview(operator, reviewId, "不能复活已到期正文"),
		).rejects.toMatchObject({ name: "DiningStoreConflictError" });
	});

	it("replays the reported revision, bounds history retention and never invents a legacy snapshot", async () => {
		const stores = createPgDiningStores({ now, pool: opsPool });
		const submissionId = await seedSubmission();
		const reviewId = await seedReview(submissionId);
		await managementPool.query(
			`insert into dining.review_reports
			(report_id, review_id, reporter_user_id, reason, details, created_at, target_revision, content_expires_at)
			values ('reported-v1', $1, 'author', 'privacy', '举报时说明', $2, 1, $3), ('legacy', $1, null, 'other', null, $2, null, null)`,
			[reviewId, now(), new Date("2026-08-23T08:00:00Z")],
		);
		await stores.reviews.updateReview(operator, reviewId, "修改后的评价");
		let reports = await stores.reviews.listReports({
			limit: 50,
			status: "pending",
			submissionId,
			targetType: "review",
		});
		expect(DiningOpsContentReportPageSchema.safeParse(reports).success).toBe(true);
		expect(reports.items.find((report) => report.reportId === "reported-v1")?.target).toMatchObject(
			{
				kind: "review",
				targetRevision: 1,
				current: { body: "修改后的评价", contentRevision: 2 },
				reported: { replayable: true, body: "原始投稿评价" },
			},
		);
		expect(reports.items.find((report) => report.reportId === "legacy")?.target).toMatchObject({
			targetRevision: null,
			reported: { replayable: false },
		});
		await managementPool.query(
			"update dining.review_edits set expires_at = $1 where review_id = $2",
			[new Date("2026-07-23T08:00:00Z"), reviewId],
		);
		reports = await stores.reviews.listReports({
			limit: 50,
			status: "pending",
			targetType: "review",
		});
		expect(
			reports.items.find((report) => report.reportId === "reported-v1")?.target.reported,
		).toEqual({ replayable: false });
		const detail = await stores.reviews.getReview(reviewId);
		expect(detail.edits[0]).toMatchObject({
			replayable: false,
			previousRevision: 1,
			nextRevision: 2,
		});
		expect(detail.edits[0]).not.toHaveProperty("previousBody");
		await managementPool.query(
			"update dining.review_reports set content_expires_at = $1 where review_id = $2",
			[new Date("2026-07-23T08:00:00Z"), reviewId],
		);
		expect(
			(await stores.reviews.listReports({ limit: 50, status: "pending" })).items.every(
				(report) => report.details === null && !report.target.reported.replayable,
			),
		).toBe(true);
		expect((await stores.reviews.listReports({ limit: 50, status: "pending" })).items).toHaveLength(
			2,
		);
	});

	it("keeps formal menu review history and report details replayable past their old retention", async () => {
		const stores = createPgDiningStores({ now, pool: opsPool });
		const item = await stores.menu.createMenuItem(operator, {
			name: "正式菜品",
			priceText: null,
			windowId: primaryWindowId,
		});
		const review = await stores.reviews.createReview(operator, {
			anonymous: false,
			body: "原始菜单评价",
			idempotencyKey: "menu-review-key",
			menuItemId: item.menuItemId,
		});
		const report = await createAppApiService().reportReview({
			details: "举报说明",
			reason: "other",
			reviewId: review.reviewId,
			userId: "user_1",
		});
		await stores.reviews.updateReview(operator, review.reviewId, "修改后的菜单评价");
		const expiredStore = createPgDiningReviewStore({
			pool: opsPool,
			now: () => new Date("2026-09-22T08:00:00Z"),
		});
		const detail = await expiredStore.getReview(review.reviewId);
		expect(DiningOpsContentReviewDetailSchema.safeParse(detail).success).toBe(true);
		expect(detail.edits[0]).toMatchObject({
			expiresAt: null,
			nextBody: "修改后的菜单评价",
			previousBody: "原始菜单评价",
			replayable: true,
		});
		const reports = await expiredStore.listReports({
			limit: 50,
			status: "pending",
			targetType: "review",
		});
		expect(DiningOpsContentReportPageSchema.safeParse(reports).success).toBe(true);
		expect(reports.items.find((entry) => entry.reportId === report.reportId)).toMatchObject({
			details: "举报说明",
			target: {
				kind: "review",
				targetRevision: 1,
				reported: { replayable: true, body: "原始菜单评价" },
			},
		});
	});

	it("merges parent and review reports without same-ID cursor collisions or cross-target resolutions", async () => {
		const stores = createPgDiningStores({ now, pool: opsPool });
		const submissionId = await seedSubmission("shared-target");
		const reviewId = await seedReview(submissionId, "shared-target");
		const acceptedAt = now();
		const expiresAt = new Date(acceptedAt.valueOf() + 30 * 86400000);
		await managementPool.query(
			`insert into dining.review_reports
			(report_id, review_id, reporter_user_id, reason, created_at, target_revision, content_expires_at)
			values ('shared-report', $1, 'author', 'other', $2, 1, $3)`,
			[reviewId, acceptedAt, expiresAt],
		);
		await managementPool.query(
			`insert into dining.submission_reports
			(report_id, submission_id, reporter_user_id, reason, created_at, target_revision, content_expires_at)
			values ('shared-report', $1, 'reader', 'other', $2, 1, $3)`,
			[submissionId, acceptedAt, expiresAt],
		);
		const first = await stores.reviews.listReports({ limit: 1, status: "pending", submissionId });
		const second = await stores.reviews.listReports({
			limit: 1,
			status: "pending",
			submissionId,
			cursor: first.nextCursor ?? "",
		});
		expect(DiningOpsContentReportPageSchema.safeParse(first).success).toBe(true);
		expect(first.items[0]?.target.kind).not.toBe(second.items[0]?.target.kind);
		expect(second.nextCursor).toBeNull();
		expect(
			(await stores.reviews.listReports({ limit: 50, status: "pending", targetType: "submission" }))
				.items,
		).toHaveLength(1);
		await stores.reviews.resolveReports(operator, reviewId, "hide");
		expect(
			(await stores.reviews.listReports({ limit: 50, status: "pending" })).items,
		).toMatchObject([{ target: { kind: "submission" } }]);
		expect(
			(
				await managementPool.query(
					"select status from dining.submissions where submission_id = $1",
					[submissionId],
				)
			).rows[0].status,
		).toBe("public");
		await managementPool.query(
			"update dining.review_reports set resolved_at = null, resolved_by = null, resolution = null where review_id = $1",
			[reviewId],
		);
		await stores.reviews.resolveReports(operator, reviewId, "keep");
		expect((await stores.reviews.getReview(reviewId)).review.hiddenAt).not.toBeNull();
	});

	it("serializes editing and hiding without losing moderation or resolving parent reports", async () => {
		const reviews = createPgDiningReviewStore({ now, pool: opsPool });
		const submissionId = await seedSubmission();
		const reviewId = await seedReview(submissionId);
		const acceptedAt = now();
		await managementPool.query(
			`insert into dining.review_reports
			(report_id, review_id, reporter_user_id, reason, created_at, target_revision, content_expires_at)
			values ('review-report', $1, 'author', 'other', $2, 1, $3)`,
			[reviewId, acceptedAt, new Date(acceptedAt.valueOf() + 30 * 86400000)],
		);
		await managementPool.query(
			`insert into dining.submission_reports
			(report_id, submission_id, reporter_user_id, reason, created_at, target_revision, content_expires_at)
			values ('parent-report', $1, 'reader', 'other', $2, 1, $3)`,
			[submissionId, acceptedAt, new Date(acceptedAt.valueOf() + 30 * 86400000)],
		);
		await Promise.all([
			reviews.updateReview(operator, reviewId, "并发修改正文"),
			reviews.setReviewVisibility(operator, reviewId, false),
		]);
		const detail = await reviews.getReview(reviewId);
		expect(detail.review).toMatchObject({ body: "并发修改正文", contentRevision: 2, editCount: 1 });
		expect(detail.review.hiddenAt).not.toBeNull();
		expect(
			(await reviews.listReports({ limit: 50, status: "pending" })).items.map(
				(report) => report.reportId,
			),
		).toEqual(["parent-report"]);
		expect(
			(await reviews.listReports({ limit: 50, status: "resolved" })).items[0]?.target,
		).toMatchObject({
			reported: { replayable: true, body: "原始投稿评价" },
			current: { body: "并发修改正文" },
		});
	});
});
