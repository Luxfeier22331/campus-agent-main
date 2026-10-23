// @vitest-environment node

import { DiningOpsSubmissionDetailSchema } from "@campus-agent/dining/domain";
import { DINING_BOOTSTRAP_FLOORPLANS } from "@campus-agent/dining/floorplans";
import { diningMapBundleFingerprint } from "@campus-agent/dining/publisher";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it, vi } from "vitest";
import { createDiningSubmissionServiceTestAdapter } from "../../app-api/test-support/dining";
import { applyOpsWebDatabaseGrants } from "../ops/db/ops-web-database";
import type { DiningFloorplanAssetStore } from "../src/server/dining-floorplan-assets";
import { createPgDiningStore } from "../src/server/dining-store";
import { createPgDiningSubmissionStore } from "../src/server/dining-submission-store";

const postgres = inject("opsWebPostgres");
const operator = { displayName: "值班员", principalId: "ops:1" };
const actor = { displayName: "投稿同学", principalId: "s4-author" };
const firstLayout = required(DINING_BOOTSTRAP_FLOORPLANS.layouts[0]);
const firstWindow = required(firstLayout.windows[0]);
const windowId = `${firstLayout.hallId}:${firstLayout.floorId}:${firstWindow.anchorId}`;
const svgAssets: DiningFloorplanAssetStore = {
	async putSvg() {
		return;
	},
	async verifyReadiness() {
		return;
	},
};

describe("Ops submission governance and map PostgreSQL boundaries", () => {
	let management: Pool;
	let appPool: Pool;
	let opsPool: Pool;
	let clock: Date;
	let serial = 0;
	const now = () => clock;
	const assets = { get: vi.fn(async () => new Uint8Array([82, 73, 70, 70])) };
	const ops = () => createPgDiningSubmissionStore({ pool: opsPool, now, assets });
	const student = () => createDiningSubmissionServiceTestAdapter({ pool: appPool, now });
	const map = (assetStore = svgAssets) => createPgDiningStore({ pool: opsPool, now, assetStore });

	beforeAll(async () => {
		await applyOpsWebDatabaseGrants({
			DEPLOYMENT_ENVIRONMENT: "local",
			OPS_WEB_DATABASE_SSLMODE: "disable",
			OPS_WEB_DATABASE_URL: postgres.opsWebConnectionString,
			OPS_WEB_SCHEMA_DATABASE_SSLMODE: "disable",
			OPS_WEB_SCHEMA_DATABASE_URL: postgres.managementConnectionString,
		});
		management = new Pool({ connectionString: postgres.managementConnectionString });
		appPool = new Pool({ connectionString: postgres.appApiConnectionString });
		opsPool = new Pool({ connectionString: postgres.opsWebConnectionString });
	});
	beforeEach(async () => {
		clock = new Date("2026-09-14T00:00:00Z");
		assets.get.mockClear();
		await management.query(
			"truncate dining.review_edits, dining.review_reports, dining.reviews, dining.menu_items, dining.submission_reports, dining.submission_edits, dining.submission_photos, dining.submissions; delete from dining.map_publication; delete from dining.map_releases; delete from dining.map_draft;",
		);
		await management.query(
			`insert into app_auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt") values ($1, $2, 's4-author@muc.edu.cn', true, $3, $3) on conflict (id) do nothing`,
			[actor.principalId, actor.displayName, clock],
		);
		await management.query(
			`insert into dining.map_draft (scope, bundle_json, fingerprint, revision, updated_at, updated_by) values ('global', $1, $2, 1, $3, 'bootstrap')`,
			[DINING_BOOTSTRAP_FLOORPLANS, diningMapBundleFingerprint(DINING_BOOTSTRAP_FLOORPLANS), clock],
		);
		await map().publish(operator, 1);
	});
	afterAll(async () => {
		await Promise.all([management?.end(), appPool?.end(), opsPool?.end()]);
	});
	async function create() {
		const result = await student().create({
			photo: null,
			actor,
			windowId,
			idempotencyKey: `s4-create-${++serial}`,
			metadata: { name: "投稿菜品", priceText: null, photoAction: "none" },
		});
		return result.submission.submissionId;
	}
	async function removeWindowDraft() {
		const bundle = structuredClone(DINING_BOOTSTRAP_FLOORPLANS);
		const layout = required(bundle.layouts[0]);
		layout.windows = layout.windows.filter((window) => window.anchorId !== firstWindow.anchorId);
		await map().saveDraft(operator, bundle, 1);
	}

	it("shares revisions with author edits and preserves hiding across deletion and restoration", async () => {
		const id = await create();
		expect(await ops().setVisibility(operator, id, 1, false)).toMatchObject({
			status: "hidden",
			revision: 2,
			contentRevision: 1,
		});
		await expect(
			student().update({
				photo: null,
				actor,
				submissionId: id,
				expectedRevision: 1,
				metadata: { name: "旧版本", priceText: null, photoAction: "keep" },
			}),
		).rejects.toMatchObject({ status: 412 });
		await student().update({
			photo: null,
			actor,
			submissionId: id,
			expectedRevision: 2,
			metadata: { name: "修改正文", priceText: "8 元", photoAction: "keep" },
		});
		expect(await ops().deleteSubmission(operator, id, 3)).toMatchObject({
			status: "deleted",
			revision: 4,
			contentRevision: 2,
		});
		const deleted = await ops().deleteSubmission(operator, id, 4);
		expect(deleted).toMatchObject({ revision: 4 });
		expect(await ops().restoreSubmission(operator, id, 4)).toMatchObject({
			status: "hidden",
			revision: 5,
			hiddenBy: operator.principalId,
		});
		expect(await ops().setVisibility(operator, id, 5, true)).toMatchObject({
			status: "public",
			revision: 6,
		});
		await expect(ops().deleteSubmission(operator, id, 3)).rejects.toThrow("投稿已更新");
		const detail = await ops().getSubmission(id);
		expect(DiningOpsSubmissionDetailSchema.safeParse(detail).success).toBe(true);
		expect(detail.edits[0]).toMatchObject({
			previousRevision: 1,
			nextRevision: 2,
			previous: { replayable: true, name: "投稿菜品" },
			next: { replayable: true, name: "修改正文" },
		});
	});

	it("refuses stale competing changes and never rewrites independent review moderation", async () => {
		const id = await create();
		const results = await Promise.allSettled([
			ops().setVisibility(operator, id, 1, false),
			student().update({
				photo: null,
				actor,
				submissionId: id,
				expectedRevision: 1,
				metadata: { name: "并发修改", priceText: null, photoAction: "keep" },
			}),
		]);
		expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
		expect((await ops().getSubmission(id)).submission.revision).toBe(2);
	});

	it("suppresses expired submission and history content before a cleanup sweep", async () => {
		const id = await create();
		await student().update({
			photo: null,
			actor,
			submissionId: id,
			expectedRevision: 1,
			metadata: { name: "第二版", priceText: null, photoAction: "keep" },
		});
		clock = new Date(clock.valueOf() + 30 * 86400000);
		const detail = await ops().getSubmission(id);
		expect(detail.edits[0]).toMatchObject({
			previous: { replayable: false },
			next: { replayable: true, name: "第二版" },
		});
		await ops().deleteSubmission(operator, id, 2);
		clock = new Date(clock.valueOf() + 30 * 86400000);
		const expired = await ops().getSubmission(id);
		expect(expired.submission.status).toBe("expired");
		expect(expired.submission).not.toHaveProperty("name");
		expect(expired.edits[0]).toMatchObject({
			previous: { replayable: false },
			next: { replayable: false },
		});
		await expect(ops().restoreSubmission(operator, id, 3)).rejects.toThrow("恢复期限");
		expect((await ops().listSubmissions({ limit: 50, status: "expired" })).items).toHaveLength(1);
		expect((await ops().listSubmissions({ limit: 50, status: "deleted" })).items).toHaveLength(0);
	});

	it("rejects restoration during account deletion and after photo cleanup starts", async () => {
		const id = await create();
		await ops().deleteSubmission(operator, id, 1);
		await management.query(
			"update dining.submissions set account_deleting_at = $2 where submission_id = $1",
			[id, clock],
		);
		expect((await ops().getSubmission(id)).submission.canRestore).toBe(false);
		await expect(ops().restoreSubmission(operator, id, 2)).rejects.toThrow("正在注销");
		await management.query(
			"update dining.submissions set account_deleting_at = null where submission_id = $1",
			[id],
		);
		await management.query(
			`insert into dining.submission_photos (photo_id, submission_id, object_key, width, height, current, cleanup_status, cleanup_started_at) values ('photo-cleaning', $1, 'dining/submissions/photo-cleaning.webp', 1, 1, true, 'running', $2)`,
			[id, clock],
		);
		expect((await ops().getSubmission(id)).submission.canRestore).toBe(false);
		await expect(ops().restoreSubmission(operator, id, 2)).rejects.toThrow("已开始清理");
	});

	it("authorizes exact photo ownership and historical expiry without exposing object coordinates", async () => {
		const id = await create();
		await management.query(
			`insert into dining.submission_photos (photo_id, submission_id, object_key, width, height, current, cleanup_status) values ('photo-current', $1, 'dining/submissions/photo-current.webp', 1, 1, true, 'pending')`,
			[id],
		);
		const fetched = await ops().getPhoto(id, "photo-current", null);
		expect(fetched).toMatchObject({
			bytes: new Uint8Array([82, 73, 70, 70]),
			etag: '"photo-current"',
		});
		expect(await ops().getPhoto(id, "photo-current", '"photo-current"')).toEqual({
			etag: '"photo-current"',
			notModified: true,
		});
		expect(await ops().getSubmission(id)).not.toHaveProperty("objectKey");
		await expect(ops().getPhoto(id, "another-photo", null)).rejects.toThrow("不可回放");
		await student().update({
			photo: null,
			actor,
			submissionId: id,
			expectedRevision: 1,
			metadata: { name: "移除图片", priceText: null, photoAction: "remove" },
		});
		await ops().getPhoto(id, "photo-current", null);
		clock = new Date(clock.valueOf() + 30 * 86400000);
		await expect(ops().getPhoto(id, "photo-current", '"photo-current"')).rejects.toThrow(
			"不可回放",
		);
		expect(assets.get).toHaveBeenCalledTimes(2);
	});

	it("protects public submission windows, allows hidden ones, and refuses orphan restoration", async () => {
		const id = await create();
		await removeWindowDraft();
		await expect(map().publish(operator, 2)).rejects.toMatchObject({
			details: { windowIds: [windowId], windows: [{ windowId, contentTypes: ["submission"] }] },
		});
		await ops().setVisibility(operator, id, 1, false);
		await map().publish(operator, 2);
		await expect(ops().setVisibility(operator, id, 2, true)).rejects.toThrow("当前公开地图");
		await expect(
			student().create({
				photo: null,
				actor,
				windowId,
				idempotencyKey: "missing-window",
				metadata: { name: "悬空", priceText: null, photoAction: "none" },
			}),
		).rejects.toMatchObject({ status: 409 });
	});

	it("rechecks public submissions created while map assets are being uploaded", async () => {
		await removeWindowDraft();
		let entered!: () => void;
		let release!: () => void;
		const started = new Promise<void>((resolve) => {
			entered = resolve;
		});
		const blocked = new Promise<void>((resolve) => {
			release = resolve;
		});
		const delayed: DiningFloorplanAssetStore = {
			...svgAssets,
			async putSvg(value) {
				entered();
				await blocked;
				return svgAssets.putSvg(value);
			},
		};
		const publication = map(delayed).publish(operator, 2);
		await started;
		await create();
		release();
		await expect(publication).rejects.toThrow("公开投稿");
	});
	it.each(["create", "restore"] as const)(
		"serializes %s behind a committed map switch",
		async (operation) => {
			const id = operation === "restore" ? await create() : null;
			if (id) {
				await ops().setVisibility(operator, id, 1, false);
			}
			await removeWindowDraft();
			const blocker = await management.connect();
			await blocker.query("begin");
			await blocker.query(
				"select pg_advisory_xact_lock(hashtextextended('dining-publication', 0))",
			);
			const publication = map().publish(operator, 2);
			try {
				await vi.waitFor(
					async () => {
						const waiting = await management.query(
							"select 1 from pg_locks where locktype = 'advisory' and mode = 'ExclusiveLock' and granted = false",
						);
						expect(waiting.rowCount).toBeGreaterThan(0);
					},
					{ timeout: 5000 },
				);
				const change = id ? ops().setVisibility(operator, id, 2, true) : create();
				const result = Promise.allSettled([publication, change]);
				await vi.waitFor(
					async () => {
						const waiting = await management.query(
							"select 1 from pg_locks where locktype = 'advisory' and mode = 'ShareLock' and granted = false",
						);
						expect(waiting.rowCount).toBeGreaterThan(0);
					},
					{ timeout: 5000 },
				);
				await blocker.query("commit");
				const settled = await result;
				expect(settled[0]?.status).toBe("fulfilled");
				expect(settled[1]?.status).toBe("rejected");
				const visible = await management.query(
					"select 1 from dining.submissions where status = 'public' and window_id = $1",
					[windowId],
				);
				expect(visible.rowCount).toBe(0);
			} finally {
				await blocker.query("rollback");
				blocker.release();
			}
		},
	);

	it("protects references when restoring an older map and never auto-unhides returning windows", async () => {
		const original = required((await map().getState()).currentRelease);
		await removeWindowDraft();
		const removed = await map().publish(operator, 2);
		await map().restore(operator, original.releaseId, 2);
		const id = await create();
		await expect(map().restore(operator, removed.releaseId, 3)).rejects.toThrow("公开投稿");
		await ops().setVisibility(operator, id, 1, false);
		await map().restore(operator, removed.releaseId, 3);
		await map().restore(operator, original.releaseId, 4);
		expect((await ops().getSubmission(id)).submission).toMatchObject({
			status: "hidden",
			windowAvailable: true,
		});
	});

	it("allows keep to resolve only submission reports without restoring hidden content", async () => {
		const id = await create();
		await management.query(
			`insert into dining.submission_reports (report_id, submission_id, reporter_user_id, reason, target_revision, content_expires_at, created_at) values ('same-id', $1, 'reporter', 'other', 1, $2, $3)`,
			[id, new Date(clock.valueOf() + 30 * 86400000), clock],
		);
		await management.query(
			`insert into dining.reviews (review_id, submission_id, author_kind, author_id, author_display_name, body, anonymous, idempotency_key, submission_date, created_at, updated_at, updated_by) values ('review-under-parent', $1, 'member', 'reporter', '评价作者', '独立评价', false, 'review-idempotency', '2026-09-14', $2, $2, 'reporter')`,
			[id, clock],
		);
		await management.query(
			`insert into dining.review_reports (report_id, review_id, reporter_user_id, reason, created_at) values ('same-id', 'review-under-parent', 'another-reporter', 'other', $1)`,
			[clock],
		);
		await ops().setVisibility(operator, id, 1, false);
		await ops().resolveReports(operator, id, 2, "keep");
		expect((await ops().getSubmission(id)).submission.status).toBe("hidden");
		expect(
			(
				await management.query(
					"select resolved_at from dining.review_reports where report_id = 'same-id'",
				)
			).rows[0].resolved_at,
		).toBeNull();
		expect(
			(
				await management.query(
					"select hidden_at, deleted_at from dining.reviews where review_id = 'review-under-parent'",
				)
			).rows[0],
		).toEqual({ hidden_at: null, deleted_at: null });
	});
});

function required<T>(value: T | null | undefined): T {
	if (value == null) {
		throw new Error("Required Dining fixture is missing.");
	}
	return value;
}
