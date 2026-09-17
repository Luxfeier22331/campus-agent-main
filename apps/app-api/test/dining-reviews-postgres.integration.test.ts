// @vitest-environment node
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import type { RuntimeDatabase } from "../src/db/runtime";
import { createPgDiningContentService } from "../src/modules/dining/content-store";
import { createPgDiningSubmissionService } from "../src/modules/dining/submission-service";

const postgres = inject("appApiPostgres");
const testEnv = { DEPLOYMENT_ENVIRONMENT: "test" } as const;

describe("Dining dual-target reviews and reports with app_api grants", () => {
	let pool: Pool;
	let management: Pool;
	let db: RuntimeDatabase;
	let clock: Date;
	let author: { principalId: string; displayName: string; kind: "member" };
	let reader: { principalId: string; displayName: string; kind: "member" };
	let windowId: string;
	let releaseId: string;
	let submissionId: string;
	let menuItemId: string;
	const applicationName = `dining-reviews-${randomUUID()}`;

	beforeAll(() => {
		pool = new Pool({
			connectionString: postgres.runtimeConnectionString,
			max: 8,
			ssl: false,
			application_name: applicationName,
		});
		management = new Pool({
			connectionString: postgres.managementConnectionString,
			max: 3,
			ssl: false,
		});
		db = drizzle({ client: pool });
	});
	afterAll(async () => {
		await Promise.all([pool.end(), management.end()]);
	});
	beforeEach(async () => {
		clock = new Date("2026-09-15T15:59:00Z");
		author = { principalId: randomUUID(), displayName: "投稿同学", kind: "member" };
		reader = { principalId: randomUUID(), displayName: "评价同学", kind: "member" };
		windowId = `window-${randomUUID()}`;
		releaseId = randomUUID();
		menuItemId = `dmi_${randomUUID()}`;
		for (const actor of [author, reader]) {
			await pool.query(
				`insert into app_auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt") values ($1,$2,$3,true,$4,$4)`,
				[actor.principalId, actor.displayName, `${actor.principalId}@muc.edu.cn`, clock],
			);
		}
		await publish([windowId]);
		await management.query(
			`insert into dining.menu_items (menu_item_id, window_id, name, sort_order, created_at, created_by, updated_at, updated_by) values ($1,$2,'菜单牛肉',0,$3,'operator',$3,'operator')`,
			[menuItemId, windowId, clock],
		);
		submissionId = (
			await submissions().create({
				actor: author,
				windowId,
				idempotencyKey: randomUUID(),
				metadata: { name: "投稿牛肉", priceText: "12 元", photoAction: "none" },
				photo: null,
			})
		).submission.submissionId;
	});
	function api() {
		return createPgDiningContentService({ getDb: async () => db, now: () => clock });
	}
	function submissions() {
		return createPgDiningSubmissionService(testEnv, { getDb: async () => db, now: () => clock });
	}
	function reviewInput(actor = reader) {
		return {
			actor,
			anonymous: false,
			body: "味道不错",
			idempotencyKey: randomUUID(),
			submissionId,
		};
	}
	function reportInput(userId = reader.principalId) {
		return { submissionId, userId, details: "举报说明", reason: "other" as const };
	}
	async function row(
		table: "reviews" | "review_reports" | "submission_reports",
		column: "review_id" | "report_id",
		id: string,
	) {
		return (await management.query(`select * from dining.${table} where ${column}=$1`, [id]))
			.rows[0];
	}
	async function waitForBlockedQuery() {
		for (let i = 0; i < 100; i++) {
			const result = await management.query(
				"select 1 from pg_stat_activity where application_name=$1 and cardinality(pg_blocking_pids(pid))>0",
				[applicationName],
			);
			if (result.rowCount) {
				return;
			}
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		throw new Error("Expected the report to wait for the content row lock.");
	}
	async function publish(windows: string[]) {
		const payload = {
			releaseId,
			updatedAt: clock.toISOString(),
			halls: [
				{
					campus: "校区",
					hallId: "hall",
					name: "食堂",
					floors: [
						{
							floorId: "floor",
							label: "一层",
							floorplan: {
								canvas: { width: 100, height: 100 },
								floorplanId: "plan",
								sha256: `sha256:${"a".repeat(64)}`,
								svgAssetUrl: `/api/dining/floorplans/${"a".repeat(64)}.svg`,
							},
							windows: windows.map((id, index) => ({
								windowId: id,
								name: "窗口",
								svgAnchorId: `w-${index}`,
							})),
						},
					],
				},
			],
		};
		await management.query(
			`insert into dining.map_releases
			(release_id,bundle_json,created_at,created_by,draft_revision,kind,public_payload_json,snapshot_hash)
			values ($1,'{}',$2,'operator',1,'publish',$3,$4)
			on conflict (release_id) do update set public_payload_json=excluded.public_payload_json`,
			[releaseId, clock, payload, `sha256:${"a".repeat(64)}`],
		);
		await management.query(
			`insert into dining.map_publication (scope,release_id,updated_at,updated_by)
			values ('global',$1,$2,'operator') on conflict (scope) do update set release_id=excluded.release_id,updated_at=excluded.updated_at`,
			[releaseId, clock],
		);
	}
	it("allows self-reviews and keeps the existing menu DTO separate from the submission target", async () => {
		const own = await api().createSubmissionReview(reviewInput(author));
		expect(own).toMatchObject({
			submissionId,
			canDelete: true,
			canReport: false,
			authorName: author.displayName,
		});
		expect(own).not.toHaveProperty("menuItemId");
		const input = reviewInput();
		const posted = await api().createSubmissionReview(input);
		expect(await api().createSubmissionReview(input)).toEqual(posted);
		await expect(
			api().createSubmissionReview({ ...input, body: "改过正文" }),
		).rejects.toMatchObject({ code: "dining_review_idempotency_conflict" });
		const { submissionId: _target, ...menuInput } = input;
		await expect(api().createReview({ ...menuInput, menuItemId })).rejects.toMatchObject({
			code: "dining_review_idempotency_conflict",
		});
		const menu = await api().createReview({
			...menuInput,
			menuItemId,
			idempotencyKey: randomUUID(),
		});
		expect(menu).toMatchObject({ menuItemId, body: input.body });
		expect(menu).not.toHaveProperty("submissionId");
		expect((await row("reviews", "review_id", posted.reviewId)).menu_item_id).toBeNull();
		expect((await row("reviews", "review_id", menu.reviewId)).submission_id).toBeNull();
		const page = await api().listSubmissionReviews({
			submissionId,
			limit: 1,
			viewerUserId: reader.principalId,
		});
		expect(page.items).toHaveLength(1);
		expect(page.nextCursor).not.toBeNull();
		const next = await api().listSubmissionReviews({
			submissionId,
			limit: 1,
			viewerUserId: null,
			cursor: page.nextCursor as string,
		});
		expect(next.items).toHaveLength(1);
		expect(next.items[0]?.reviewId).not.toBe(page.items[0]?.reviewId);
	});

	it("serializes concurrent submissions, counts deleted reviews and resets only at Shanghai midnight", async () => {
		const input = reviewInput();
		const duplicates = await Promise.all([
			api().createSubmissionReview(input),
			api().createSubmissionReview(input),
		]);
		expect(duplicates[0]).toEqual(duplicates[1]);
		const results = await Promise.allSettled(
			Array.from({ length: 4 }, () => api().createSubmissionReview(reviewInput())),
		);
		expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(2);
		for (const result of results.filter((result) => result.status === "rejected")) {
			expect(result.reason).toMatchObject({ code: "dining_review_daily_limit", status: 409 });
		}
		await api().deleteOwnReview({ reviewId: duplicates[0]?.reviewId, userId: reader.principalId });
		await expect(api().createSubmissionReview(reviewInput())).rejects.toMatchObject({
			code: "dining_review_daily_limit",
		});
		const { submissionId: _target, ...menuInput } = reviewInput();
		await expect(api().createReview({ ...menuInput, menuItemId })).resolves.toHaveProperty(
			"menuItemId",
			menuItemId,
		);
		clock = new Date("2026-09-15T16:00:00Z");
		const nextDay = await api().createSubmissionReview(reviewInput());
		expect(
			(
				await management.query(
					"select submission_date::text as day from dining.reviews where review_id=$1",
					[nextDay.reviewId],
				)
			).rows[0]?.day,
		).toBe("2026-09-16");
	});

	it.each([
		"hidden",
		"deleted",
		"purged",
		"account_deleting",
		"window_removed",
		"author_deletion_requested",
	] as const)(
		"gates public reviews, new reviews and reports for parent %s without rewriting review visibility",
		async (state) => {
			const review = await api().createSubmissionReview(reviewInput());
			if (state === "window_removed") {
				await publish([]);
			} else if (state === "author_deletion_requested") {
				await management.query(
					`insert into profile.account_deletion_requests (request_id,owner_user_id,status,requested_at,next_attempt_at,updated_at) values ($1,$2,'pending',$3,$3,$3)`,
					[randomUUID(), author.principalId, clock],
				);
			} else {
				const updates = {
					hidden: "status='hidden',hidden_at=now(),hidden_by='operator'",
					deleted:
						"status='deleted',deleted_at=now(),deleted_by='operator',expires_at=now()+interval '30 days'",
					purged: "status='purged',purged_at=now()",
					account_deleting: "account_deleting_at=now()",
				};
				await management.query(
					`update dining.submissions set ${updates[state]} where submission_id=$1`,
					[submissionId],
				);
			}
			await expect(
				api().listSubmissionReviews({ submissionId, limit: 20, viewerUserId: null }),
			).rejects.toMatchObject({ status: 404 });
			await expect(api().createSubmissionReview(reviewInput())).rejects.toMatchObject({
				status: 404,
			});
			await expect(api().reportSubmission(reportInput())).rejects.toMatchObject({ status: 404 });
			await expect(
				api().reportReview({ ...reportInput(), reviewId: review.reviewId }),
			).rejects.toMatchObject({ status: 404 });
			expect(await row("reviews", "review_id", review.reviewId)).toMatchObject({
				hidden_at: null,
				deleted_at: null,
				body: "味道不错",
			});
		},
	);

	it("retains independently hidden reviews when the parent becomes public again", async () => {
		const visible = await api().createSubmissionReview(reviewInput());
		const hiddenInput = reviewInput();
		const hidden = await api().createSubmissionReview(hiddenInput);
		await management.query(
			`update dining.reviews set hidden_at=$1,hidden_by='operator' where review_id=$2`,
			[clock, hidden.reviewId],
		);
		await management.query(
			`update dining.submissions set status='hidden',hidden_at=$1,hidden_by='operator' where submission_id=$2`,
			[clock, submissionId],
		);
		await management.query(
			`update dining.submissions set status='public',hidden_at=null,hidden_by=null where submission_id=$1`,
			[submissionId],
		);
		expect(
			(
				await api().listSubmissionReviews({ submissionId, limit: 20, viewerUserId: null })
			).items.map((item) => item.reviewId),
		).toEqual([visible.reviewId]);
		await expect(api().createSubmissionReview(hiddenInput)).rejects.toMatchObject({ status: 404 });
		await expect(
			api().reportReview({ ...reportInput(author.principalId), reviewId: hidden.reviewId }),
		).rejects.toMatchObject({ status: 404 });
	});

	it("rejects self-reporting but allows the submission author to report another person's review", async () => {
		await expect(api().reportSubmission(reportInput(author.principalId))).rejects.toMatchObject({
			code: "dining_submission_self_report_forbidden",
			status: 403,
		});
		const review = await api().createSubmissionReview(reviewInput());
		await expect(
			api().reportReview({ ...reportInput(), reviewId: review.reviewId }),
		).rejects.toMatchObject({ code: "dining_review_self_report_forbidden", status: 400 });
		const report = await api().reportReview({
			...reportInput(author.principalId),
			reviewId: review.reviewId,
		});
		expect(await row("review_reports", "report_id", report.reportId)).toMatchObject({
			review_id: review.reviewId,
			reporter_user_id: author.principalId,
			target_revision: 1,
			content_expires_at: new Date(clock.getTime() + 30 * 86400_000),
		});
		const page = await api().listSubmissionReviews({
			submissionId,
			limit: 20,
			viewerUserId: author.principalId,
		});
		expect(page.items[0]).toMatchObject({ hasReported: true, canReport: false, canDelete: false });
	});

	it("keeps formal menu review reports without a retention deadline", async () => {
		const { submissionId: _target, ...menuReviewInput } = reviewInput();
		const menu = await api().createReview({ ...menuReviewInput, menuItemId });
		const report = await api().reportReview({
			...reportInput(author.principalId),
			reviewId: menu.reviewId,
		});
		expect(await row("review_reports", "report_id", report.reportId)).toMatchObject({
			review_id: menu.reviewId,
			content_expires_at: null,
		});
	});

	it("replays the original review report after editing and closing it without changing its retention", async () => {
		const review = await api().createSubmissionReview(reviewInput(author));
		const input = { ...reportInput(), reviewId: review.reviewId };
		const report = await api().reportReview(input);
		const original = await row("review_reports", "report_id", report.reportId);
		await management.query(
			`update dining.reviews set body='编辑后',content_revision=2,hidden_at=$1,hidden_by='operator' where review_id=$2`,
			[clock, review.reviewId],
		);
		await management.query(
			`update dining.review_reports set resolution='hide',resolved_at=$1,resolved_by='operator' where report_id=$2`,
			[clock, report.reportId],
		);
		expect(await api().reportReview({ ...input, reason: "spam", details: "新说明" })).toEqual(
			report,
		);
		expect(await row("review_reports", "report_id", report.reportId)).toMatchObject({
			target_revision: 1,
			details: original.details,
			reason: original.reason,
			content_expires_at: original.content_expires_at,
			resolution: "hide",
		});
	});

	it("keeps the original report and revision through concurrent repeats, edits and resolution", async () => {
		const input = reportInput();
		const reports = await Promise.all([
			api().reportSubmission(input),
			api().reportSubmission(input),
		]);
		expect(reports[0]).toEqual(reports[1]);
		const original = await row("submission_reports", "report_id", reports[0]?.reportId);
		await submissions().update({
			actor: author,
			submissionId,
			expectedRevision: 1,
			metadata: { name: "编辑之后", priceText: null, photoAction: "keep" },
			photo: null,
		});
		await management.query(
			`update dining.submission_reports set resolution='hide',resolved_at=$1,resolved_by='operator' where report_id=$2`,
			[clock, original.report_id],
		);
		await management.query(
			`update dining.submissions set status='hidden',hidden_at=$1,hidden_by='operator' where submission_id=$2`,
			[clock, submissionId],
		);
		expect(await api().reportSubmission({ ...input, reason: "spam", details: "新的说明" })).toEqual(
			reports[0],
		);
		expect(await row("submission_reports", "report_id", original.report_id)).toMatchObject({
			target_revision: 1,
			details: input.details,
			reason: input.reason,
			resolution: "hide",
			content_expires_at: original.content_expires_at,
		});
	});

	it.each(["submission", "review"] as const)(
		"records the accepted %s revision under the content editor's row lock",
		async (kind) => {
			const review =
				kind === "review" ? await api().createSubmissionReview(reviewInput(author)) : null;
			const table = kind === "review" ? "reviews" : "submissions";
			const column = kind === "review" ? "review_id" : "submission_id";
			const targetId = review?.reviewId ?? submissionId;
			const editor = await management.connect();
			let pending: Promise<{ reportId: string }> | undefined;
			try {
				await editor.query("begin");
				await editor.query(`select 1 from dining.${table} where ${column}=$1 for update`, [
					targetId,
				]);
				pending =
					kind === "review"
						? api().reportReview({ ...reportInput(), reviewId: targetId })
						: api().reportSubmission(reportInput());
				await waitForBlockedQuery();
				await editor.query(
					`update dining.${table} set content_revision=2 ${kind === "review" ? ", body='编辑后评价'" : ", revision=2, name='编辑后投稿'"} where ${column}=$1`,
					[targetId],
				);
				await editor.query("commit");
				const result = await pending;
				expect(
					await row(
						kind === "review" ? "review_reports" : "submission_reports",
						"report_id",
						result.reportId,
					),
				).toMatchObject({ target_revision: 2 });
			} finally {
				await editor.query("rollback");
				editor.release();
				await pending?.catch(() => undefined);
			}
		},
	);

	it("blocks member writes when account deletion has been accepted", async () => {
		await management.query(
			`insert into profile.account_deletion_requests (request_id,owner_user_id,status,requested_at,next_attempt_at,updated_at) values ($1,$2,'pending',$3,$3,$3)`,
			[randomUUID(), reader.principalId, clock],
		);
		await expect(api().createSubmissionReview(reviewInput())).rejects.toMatchObject({
			code: "BANNED_USER",
			status: 403,
		});
		await expect(api().reportSubmission(reportInput())).rejects.toMatchObject({
			code: "BANNED_USER",
			status: 403,
		});
	});
});
