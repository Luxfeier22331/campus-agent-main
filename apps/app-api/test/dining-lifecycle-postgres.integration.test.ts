import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it, vi } from "vitest";
import type { RuntimeDatabase } from "../src/db/runtime";
import { diningReviews, diningSubmissionPhotos, diningSubmissions } from "../src/db/schema";
import { createPgAccountLifecycleStore } from "../src/modules/account-lifecycle";
import { createPgDiningLifecycleService } from "../src/modules/dining/lifecycle";
import type { DiningSubmissionObjects } from "../src/modules/dining/submission-media";
import { createSubmissionMediaStore } from "../src/modules/dining/submission-store-media";

const postgres = inject("appApiPostgres");
const retention = 30 * 24 * 60 * 60 * 1000;

describe("Dining lifecycle through the actual app_api role", () => {
	let pool: Pool;
	let management: Pool;
	let db: RuntimeDatabase;
	let now: Date;
	let objects: DiningSubmissionObjects;
	beforeAll(() => {
		pool = new Pool({ connectionString: postgres.runtimeConnectionString, max: 6, ssl: false });
		management = new Pool({ connectionString: postgres.managementConnectionString, ssl: false });
		db = drizzle({ client: pool });
	});
	afterAll(async () => {
		await Promise.all([pool.end(), management.end()]);
	});
	beforeEach(async () => {
		await management.query(
			"truncate dining.submissions, dining.reviews, profile.account_deletion_requests cascade",
		);
		now = new Date("2026-10-01T00:00:00Z");
		objects = { put: vi.fn(), get: vi.fn(), deleteAllVersions: vi.fn(async () => undefined) };
	});
	function service() {
		return createPgDiningLifecycleService({}, { getDb: async () => db, now: () => now, objects });
	}
	async function parent(values: Partial<typeof diningSubmissions.$inferInsert> = {}) {
		const submissionId = randomUUID();
		await db.insert(diningSubmissions).values({
			submissionId,
			status: "public",
			name: "当前菜名",
			revision: 2,
			contentRevision: 2,
			createdAt: now,
			updatedAt: now,
			createdSubmissionDate: "2026-10-01",
			authorId: randomUUID(),
			authorDisplayName: "原作者",
			windowId: "窗口",
			createdName: "创建菜名",
			createdInputSha256: "original-digest",
			idempotencyKey: randomUUID(),
			...values,
		});
		return submissionId;
	}
	async function review(submissionId: string, authorId = randomUUID()) {
		const reviewId = randomUUID();
		await db.insert(diningReviews).values({
			reviewId,
			submissionId,
			authorId,
			authorKind: "member",
			authorDisplayName: "评价者",
			anonymous: false,
			body: "评价正文",
			idempotencyKey: randomUUID(),
			createdAt: now,
			updatedAt: now,
			updatedBy: authorId,
			submissionDate: "2026-10-01",
		});
		return reviewId;
	}
	async function photo(submissionId: string) {
		const photoId = randomUUID();
		await db.insert(diningSubmissionPhotos).values({
			photoId,
			submissionId,
			current: true,
			cleanupStatus: "pending",
			objectKey: `dining/submissions/${photoId}.webp`,
			width: 1,
			height: 1,
		});
		return photoId;
	}
	async function row(id: string) {
		return (await pool.query("select * from dining.submissions where submission_id=$1", [id]))
			.rows[0];
	}
	async function history(id: string, expiresAt: Date) {
		await pool.query(
			`insert into dining.submission_edits
			(edit_id, submission_id, previous_revision, next_revision, previous_name, next_name, edited_by, edited_at, expires_at)
			values ($1,$2,1,2,'旧菜名','重复正文','编辑者',$3,$4)`,
			[randomUUID(), id, new Date(expiresAt.getTime() - retention), expiresAt],
		);
	}
	async function report(id: string, expiresAt: Date, reporter = randomUUID()) {
		const reportId = randomUUID();
		await pool.query(
			`insert into dining.submission_reports
			(report_id, submission_id, reporter_user_id, reason, details, target_revision, created_at, content_expires_at)
			values ($1,$2,$3,'other','举报详情',2,$4,$5)`,
			[reportId, id, reporter, new Date(expiresAt.getTime() - retention), expiresAt],
		);
		return reportId;
	}

	it("clears expired text/report details at their own UTC boundary without resolving pending reports or expiring current/hidden content", async () => {
		const publicId = await parent();
		const hiddenId = await parent({ status: "hidden", hiddenAt: now });
		await photo(publicId);
		await photo(hiddenId);
		const expiry = new Date(now.getTime() + 1);
		await history(publicId, expiry);
		const reportId = await report(publicId, expiry);
		await service().sweep();
		expect(
			(
				await pool.query(
					"select previous_name from dining.submission_edits where submission_id=$1",
					[publicId],
				)
			).rows[0].previous_name,
		).toBe("旧菜名");
		now = expiry;
		await service().sweep();
		expect(
			(await pool.query("select * from dining.submission_edits where submission_id=$1", [publicId]))
				.rowCount,
		).toBe(0);
		expect(
			(
				await pool.query(
					"select details, resolution, reporter_user_id from dining.submission_reports where report_id=$1",
					[reportId],
				)
			).rows[0],
		).toMatchObject({ details: null, resolution: null });
		expect((await row(publicId)).name).toBe("当前菜名");
		expect((await row(hiddenId)).name).toBe("当前菜名");
		expect(objects.deleteAllVersions).not.toHaveBeenCalled();
	});

	it("keeps formal menu review history and report details permanently while submission review history expires", async () => {
		const menuItemId = `dmi_${randomUUID()}`;
		await management.query(
			`insert into dining.menu_items (menu_item_id, window_id, name, sort_order, created_at, created_by, updated_at, updated_by)
			values ($1,'窗口','正式菜品',0,$2,'operator',$2,'operator')`,
			[menuItemId, now],
		);
		const menuReviewId = randomUUID();
		await db.insert(diningReviews).values({
			reviewId: menuReviewId,
			menuItemId,
			authorKind: "member",
			authorId: randomUUID(),
			authorDisplayName: "评价者",
			anonymous: false,
			body: "菜单评价",
			idempotencyKey: randomUUID(),
			createdAt: now,
			updatedAt: now,
			submissionDate: "2026-10-01",
		});
		const submissionReviewId = await review(await parent());
		const expiredAt = new Date(now.getTime() - 1);
		for (const reviewId of [menuReviewId, submissionReviewId]) {
			await management.query(
				`insert into dining.review_edits (edit_id, review_id, edited_by, edited_at, previous_body, next_body, previous_revision, next_revision, expires_at)
				values ($1,$2,'编辑者',$3,'旧正文','新正文',1,2,$4)`,
				[randomUUID(), reviewId, new Date(now.getTime() - retention), expiredAt],
			);
			await management.query(
				`insert into dining.review_reports (report_id, review_id, reporter_user_id, reason, details, created_at, target_revision, content_expires_at)
				values ($1,$2,$3,'other','举报详情',$4,1,$5)`,
				[randomUUID(), reviewId, randomUUID(), new Date(now.getTime() - retention), expiredAt],
			);
		}
		await service().sweep();
		// Even a legacy deadline on a formal menu review must not remove or expire it.
		expect(
			(
				await management.query(
					"select previous_body, expires_at from dining.review_edits where review_id=$1",
					[menuReviewId],
				)
			).rows[0],
		).toMatchObject({ previous_body: "旧正文", expires_at: expiredAt });
		expect(
			(
				await management.query("select details from dining.review_reports where review_id=$1", [
					menuReviewId,
				])
			).rows[0].details,
		).toBe("举报详情");
		expect(
			(
				await management.query("select * from dining.review_edits where review_id=$1", [
					submissionReviewId,
				])
			).rowCount,
		).toBe(0);
		expect(
			(
				await management.query("select details from dining.review_reports where review_id=$1", [
					submissionReviewId,
				])
			).rows[0].details,
		).toBeNull();
	});

	it("purges parent data and dedup records, retains other reviews for exactly 30 days then removes the last FK placeholder", async () => {
		const expiry = new Date(now.getTime() + 1);
		const id = await parent({
			status: "deleted",
			deletedAt: new Date(now.getTime() - retention + 1),
			expiresAt: expiry,
		});
		const otherReview = await review(id);
		await history(id, new Date(now.getTime() + retention));
		await report(id, new Date(now.getTime() + retention));
		await photo(id);
		await service().sweep();
		expect((await row(id)).name).toBe("当前菜名");
		now = expiry;
		await service().sweep();
		expect(await row(id)).toMatchObject({
			status: "purged",
			purged_at: now,
			author_id: null,
			author_display_name: null,
			name: null,
			window_id: null,
			created_name: null,
			created_input_sha256: null,
			idempotency_key: null,
		});
		expect(
			(await pool.query("select * from dining.submission_reports where submission_id=$1", [id]))
				.rowCount,
		).toBe(0);
		expect(
			(await pool.query("select body from dining.reviews where review_id=$1", [otherReview]))
				.rows[0].body,
		).toBe("评价正文");
		now = new Date(expiry.getTime() + retention - 1);
		await service().sweep();
		expect(await row(id)).toBeDefined();
		now = new Date(expiry.getTime() + retention);
		await service().sweep();
		expect(await row(id)).toBeUndefined();
		await service().sweep();
	});

	it("keeps failed byte cleanup pending after identity removal, then completes immediately without waiting for other users' reviews", async () => {
		const userId = randomUUID();
		const requestId = randomUUID();
		await pool.query(
			`insert into app_auth."user" (id,name,email,"emailVerified","createdAt","updatedAt") values ($1,'作者',$2,true,$3,$3)`,
			[userId, `${userId}@muc.edu.cn`, now],
		);
		const id = await parent({ authorId: userId, createdBy: userId, updatedBy: userId });
		const otherId = await parent();
		await review(id);
		await review(otherId, userId);
		await report(otherId, new Date(now.getTime() + retention), userId);
		await photo(id);
		const account = createPgAccountLifecycleStore({ getDb: async () => db });
		await account.requestDeletion({ ownerUserId: userId, requestId, requestedAt: now });
		expect(await row(id)).toMatchObject({
			account_deleting_at: now,
			account_deletion_request_id: requestId,
		});
		vi.mocked(objects.deleteAllVersions).mockRejectedValueOnce(new Error("denied"));
		await expect(
			service().eraseForAccountDeletion({ ownerUserId: userId, requestId }),
		).rejects.toThrow("Dining cleanup failed");
		expect(await row(id)).toMatchObject({
			status: "expired",
			author_id: null,
			name: null,
			account_deletion_request_id: requestId,
			purged_at: null,
		});
		expect(
			(await pool.query("select * from dining.reviews where author_id=$1", [userId])).rowCount,
		).toBe(0);
		expect(
			(
				await pool.query(
					"select details,reporter_user_id from dining.submission_reports where submission_id=$1",
					[otherId],
				)
			).rows[0],
		).toEqual({ details: null, reporter_user_id: null });
		await expect(
			service().eraseForAccountDeletion({ ownerUserId: userId, requestId }),
		).resolves.toBe(true);
		expect(await row(id)).toMatchObject({
			status: "purged",
			account_deletion_request_id: null,
			purged_at: now,
		});
		await expect(
			service().eraseForAccountDeletion({ ownerUserId: userId, requestId }),
		).resolves.toBe(true);
	});

	it("cleans up account identities in review history, reports and last-modifier fields without reading historical bodies", async () => {
		const userId = randomUUID();
		const id = await parent();
		const rid = await review(id);
		await management.query(
			"update dining.reviews set updated_by=$1, hidden_by=$1, deleted_by=$1 where review_id=$2",
			[userId, rid],
		);
		await management.query(
			`insert into dining.review_edits (edit_id,review_id,edited_by,edited_at,previous_body,next_body,expires_at)
			values ($1,$2,$3,$4,'旧评价','新评价',$5)`,
			[randomUUID(), rid, userId, now, new Date(now.getTime() + retention)],
		);
		await management.query(
			`insert into dining.review_reports (report_id,review_id,reporter_user_id,reason,details,created_at)
			values ($1,$2,$3,'other','详情',$4)`,
			[randomUUID(), rid, userId, now],
		);
		await expect(
			service().eraseForAccountDeletion({ ownerUserId: userId, requestId: randomUUID() }),
		).resolves.toBe(true);
		expect(
			(
				await pool.query(
					"select updated_by,hidden_by,deleted_by,body from dining.reviews where review_id=$1",
					[rid],
				)
			).rows[0],
		).toEqual({ updated_by: null, hidden_by: null, deleted_by: null, body: "评价正文" });
		expect(
			(
				await management.query(
					"select edited_by,previous_body from dining.review_edits where review_id=$1",
					[rid],
				)
			).rows[0],
		).toEqual({ edited_by: null, previous_body: "旧评价" });
		await expect(pool.query("select previous_body from dining.review_edits")).rejects.toMatchObject(
			{ code: "42501" },
		);
	});
	it("accepts an in-flight orphan under the same user lock and waits for its upload lease before account completion", async () => {
		const userId = randomUUID();
		const requestId = randomUUID();
		await pool.query(
			`insert into app_auth."user" (id,name,email,"emailVerified","createdAt","updatedAt") values ($1,'作者',$2,true,$3,$3)`,
			[userId, `${userId}@muc.edu.cn`, now],
		);
		let beginPut!: () => void;
		let finishPut!: () => void;
		const started = new Promise<void>((resolve) => {
			beginPut = resolve;
		});
		const blocked = new Promise<void>((resolve) => {
			finishPut = resolve;
		});
		vi.mocked(objects.put).mockImplementation(async () => {
			beginPut();
			await blocked;
			return { versionId: "v1" };
		});
		const media = createSubmissionMediaStore({
			getDb: async () => db,
			now: () => now,
			objects: () => objects,
			images: () => ({
				normalize: async () => ({ bytes: new Uint8Array([1]), width: 1, height: 1 }),
			}),
		});
		const uploading = media.upload(new Uint8Array([1]), userId);
		await started;
		await createPgAccountLifecycleStore({ getDb: async () => db }).requestDeletion({
			ownerUserId: userId,
			requestId,
			requestedAt: now,
		});
		try {
			await expect(
				service().eraseForAccountDeletion({ ownerUserId: userId, requestId }),
			).resolves.toBe(false);
			expect(objects.deleteAllVersions).not.toHaveBeenCalled();
			expect(
				(
					await pool.query(
						"select upload_owner_id, account_deletion_request_id from dining.submission_photos",
					)
				).rows[0],
			).toEqual({ upload_owner_id: null, account_deletion_request_id: requestId });
		} finally {
			finishPut();
		}
		await uploading;
		now = new Date(now.getTime() + 5 * 60 * 1000);
		await expect(
			service().eraseForAccountDeletion({ ownerUserId: userId, requestId }),
		).resolves.toBe(true);
		expect(objects.deleteAllVersions).toHaveBeenCalledOnce();
	});
});
