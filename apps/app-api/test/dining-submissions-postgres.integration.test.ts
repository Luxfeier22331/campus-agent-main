// @vitest-environment node
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it, vi } from "vitest";
import type { RuntimeDatabase } from "../src/db/runtime";
import type {
	DiningImageProcessor,
	DiningSubmissionObjects,
} from "../src/modules/dining/submission-media";
import { createPgDiningSubmissionService } from "../src/modules/dining/submission-service";

const postgres = inject("appApiPostgres");
const testEnv = { DEPLOYMENT_ENVIRONMENT: "test" } as const;
const photoBytes = new Uint8Array([1, 2, 3]);
const normalizedBytes = new Uint8Array([4, 5, 6]);
const fields = { name: "炖牛肉", priceText: "12 元", photoAction: "none" as const };

describe("Dining submission PostgreSQL persistence with app_api grants", () => {
	let pool: Pool;
	let management: Pool;
	let db: RuntimeDatabase;
	let clock: Date;
	let author: { principalId: string; displayName: string };
	let windowId: string;
	let otherWindowId: string;
	let releaseId: string;
	let stored: Map<string, Uint8Array>;
	let images: DiningImageProcessor;
	let objects: DiningSubmissionObjects;

	beforeAll(() => {
		pool = new Pool({ connectionString: postgres.runtimeConnectionString, max: 8, ssl: false });
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
		clock = new Date("2026-09-15T00:00:00Z");
		author = { principalId: randomUUID(), displayName: "投稿同学" };
		windowId = `window-${randomUUID()}`;
		otherWindowId = `other-${randomUUID()}`;
		releaseId = randomUUID();
		await addUser(author.principalId);
		await publish([windowId, otherWindowId]);
		stored = new Map();
		images = { normalize: vi.fn(async () => ({ bytes: normalizedBytes, width: 40, height: 30 })) };
		objects = {
			put: vi.fn(async (key, photo) => {
				stored.set(key, photo.bytes);
				return { versionId: "v1" };
			}),
			get: vi.fn(async (key) => stored.get(key) ?? null),
			deleteAllVersions: vi.fn(async (key) => {
				stored.delete(key);
			}),
		};
	});

	function service(options: Partial<Parameters<typeof createPgDiningSubmissionService>[1]> = {}) {
		return createPgDiningSubmissionService(testEnv, {
			getDb: async () => db,
			now: () => clock,
			images,
			objects,
			...options,
		});
	}
	function createInput(key = randomUUID()) {
		return { actor: author, windowId, idempotencyKey: key, metadata: fields, photo: null };
	}
	async function addUser(id: string) {
		await pool.query(
			`insert into app_auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
			values ($1, '投稿同学', $2, true, $3, $3)`,
			[id, `${id}@muc.edu.cn`, clock],
		);
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
	async function ownRow(submissionId: string) {
		return (
			await management.query("select * from dining.submissions where submission_id=$1", [
				submissionId,
			])
		).rows[0];
	}

	it("creates imageless submissions without media configuration, preserving immutable identity after editing", async () => {
		const plain = createPgDiningSubmissionService(testEnv, {
			getDb: async () => db,
			now: () => clock,
		});
		const input = createInput();
		const { submission } = await plain.create(input);
		expect(submission).toMatchObject({
			name: fields.name,
			status: "public",
			photo: null,
			revision: 1,
			canEdit: true,
		});
		const updated = await plain.update({
			actor: author,
			submissionId: submission.submissionId,
			expectedRevision: 1,
			metadata: { name: "红烧牛肉", priceText: null, photoAction: "keep" },
			photo: null,
		});
		expect(updated.submission.revision).toBe(2);
		expect((await plain.create(input)).submission).toEqual(updated.submission);
		await expect(
			plain.create({ ...input, metadata: { ...fields, name: "另一道菜" } }),
		).rejects.toMatchObject({ code: "dining_submission_idempotency_conflict" });
		const row = await ownRow(submission.submissionId);
		expect(row).toMatchObject({
			created_name: fields.name,
			created_photo_action: "none",
			created_input_sha256: null,
			content_revision: 2,
		});
		const history = await management.query(
			"select * from dining.submission_edits where submission_id=$1",
			[submission.submissionId],
		);
		expect(history.rows).toHaveLength(1);
		expect(history.rows[0]).toMatchObject({
			previous_name: fields.name,
			next_name: "红烧牛肉",
			previous_revision: 1,
			next_revision: 2,
			expires_at: new Date(clock.getTime() + 30 * 86400_000),
		});
		expect(images.normalize).not.toHaveBeenCalled();
	});

	it("serializes same-key replay and conflicting creates, and caps concurrent success across windows", async () => {
		const api = service();
		const input = createInput();
		const results = await Promise.all([api.create(input), api.create(input), api.create(input)]);
		expect(new Set(results.map((result) => result.submission.submissionId)).size).toBe(1);
		const otherKey = randomUUID();
		const distinct = await Promise.allSettled([
			api.create(createInput(otherKey)),
			api.create({ ...createInput(otherKey), metadata: { ...fields, name: "另一份" } }),
		]);
		expect(distinct.filter((result) => result.status === "fulfilled")).toHaveLength(1);
		expect(distinct.find((result) => result.status === "rejected")).toMatchObject({
			reason: { code: "dining_submission_idempotency_conflict" },
		});
		const lastSlots = await Promise.allSettled(
			Array.from({ length: 4 }, () => api.create({ ...createInput(), windowId: otherWindowId })),
		);
		expect(lastSlots.filter((result) => result.status === "fulfilled")).toHaveLength(1);
		for (const result of lastSlots.filter((result) => result.status === "rejected")) {
			expect(result).toMatchObject({
				reason: { code: "dining_submission_daily_limit", status: 429 },
			});
		}
	});

	it("counts hidden/deleted submissions and changes quota at Shanghai midnight", async () => {
		clock = new Date("2026-09-15T15:59:59Z");
		const api = service();
		const first = (await api.create(createInput())).submission;
		await api.deleteOwn({
			userId: author.principalId,
			submissionId: first.submissionId,
			expectedRevision: 1,
		});
		const second = (await api.create(createInput())).submission;
		await management.query(
			"update dining.submissions set status='hidden',hidden_at=$2,hidden_by='ops',revision=revision+1 where submission_id=$1",
			[second.submissionId, clock],
		);
		await api.create(createInput());
		await expect(api.create(createInput())).rejects.toMatchObject({
			code: "dining_submission_daily_limit",
		});
		clock = new Date("2026-09-15T16:00:00Z");
		const next = (await api.create(createInput())).submission;
		expect(
			(
				await management.query(
					"select created_submission_date::text as day from dining.submissions where submission_id=$1",
					[next.submissionId],
				)
			).rows[0]?.day,
		).toBe("2026-09-16");
	});

	it("rejects stale edit races, keeps no-op edits out of history, and does not unhide content", async () => {
		const api = service();
		const { submission } = await api.create(createInput());
		const update = {
			actor: author,
			submissionId: submission.submissionId,
			expectedRevision: 1,
			metadata: { ...fields, photoAction: "keep" as const },
			photo: null,
		};
		expect((await api.update(update)).submission.revision).toBe(1);
		const races = await Promise.allSettled([
			api.update({ ...update, metadata: { ...update.metadata, name: "甲" } }),
			api.update({ ...update, metadata: { ...update.metadata, name: "乙" } }),
		]);
		expect(races.filter((r) => r.status === "fulfilled")).toHaveLength(1);
		expect(races.find((r) => r.status === "rejected")).toMatchObject({
			reason: { code: "dining_submission_revision_conflict" },
		});
		await expect(api.update(update)).rejects.toMatchObject({ status: 412 });
		await management.query(
			"update dining.submissions set status='hidden',hidden_at=$2,hidden_by='ops',revision=3 where submission_id=$1",
			[submission.submissionId, clock],
		);
		const hidden = await api.update({
			...update,
			expectedRevision: 3,
			metadata: { ...update.metadata, name: "隐藏稿编辑" },
		});
		expect(hidden.submission).toMatchObject({ status: "hidden", revision: 4, name: "隐藏稿编辑" });
		expect((await ownRow(submission.submissionId)).content_revision).toBe(3);
		expect(
			(
				await management.query("select 1 from dining.submission_edits where submission_id=$1", [
					submission.submissionId,
				])
			).rowCount,
		).toBe(2);
	});

	it("keeps delete deadlines stable, hides deleted content, and rejects old delete after restoration", async () => {
		const api = service();
		const input = createInput();
		const { submission } = await api.create(input);
		const deletion = {
			userId: author.principalId,
			submissionId: submission.submissionId,
			expectedRevision: 1,
		};
		await api.deleteOwn(deletion);
		const first = await ownRow(submission.submissionId);
		clock = new Date(clock.getTime() + 1000);
		await api.deleteOwn(deletion);
		await api.deleteOwn({ ...deletion, expectedRevision: 2 });
		expect((await ownRow(submission.submissionId)).expires_at).toEqual(first.expires_at);
		const replay = (await api.create(input)).submission;
		expect(replay).toMatchObject({
			status: "deleted",
			revision: 2,
			canDelete: false,
			canEdit: false,
		});
		expect(replay).not.toHaveProperty("name");
		expect(replay).not.toHaveProperty("photo");
		await expect(
			api.update({
				actor: author,
				submissionId: submission.submissionId,
				expectedRevision: 2,
				metadata: { ...fields, photoAction: "keep" },
				photo: null,
			}),
		).rejects.toMatchObject({ code: "dining_submission_state_conflict" });
		clock = new Date(first.expires_at.getTime());
		expect(
			(await api.getOwn({ userId: author.principalId, submissionId: submission.submissionId }))
				.submission.status,
		).toBe("expired");
		await management.query(
			"update dining.submissions set status='public',deleted_at=null,deleted_by=null,expires_at=null,revision=3,updated_at=$2 where submission_id=$1",
			[submission.submissionId, clock],
		);
		await expect(api.deleteOwn(deletion)).rejects.toMatchObject({ status: 412 });
		await api.deleteOwn({ ...deletion, expectedRevision: 3 });
		await expect(api.deleteOwn(deletion)).rejects.toMatchObject({ status: 412 });
	});

	it("returns strict public and owner projections and authorizes each current photo reference", async () => {
		const api = service();
		const input = {
			...createInput(),
			metadata: { ...fields, photoAction: "replace" as const },
			photo: photoBytes,
		};
		const { submission } = await api.create(input);
		if (!("photo" in submission && submission.photo)) {
			throw new Error("photo missing");
		}
		const photoId = submission.photo.photoId;
		expect(submission.photo.url).toBe(
			`/api/dining/me/submissions/${submission.submissionId}/photos/${photoId}`,
		);
		const publicView = (
			await api.getPublic({ submissionId: submission.submissionId, viewerUserId: "reader" })
		).submission;
		expect(publicView).toMatchObject({
			source: "user_submission",
			authorName: author.displayName,
			canReport: true,
			hasReported: false,
		});
		expect(publicView).not.toHaveProperty("authorId");
		expect(publicView).not.toHaveProperty("revision");
		expect(
			(
				await api.getPublic({
					submissionId: submission.submissionId,
					viewerUserId: author.principalId,
				})
			).submission.canReport,
		).toBe(false);
		await expect(
			api.getPhoto({
				submissionId: submission.submissionId,
				photoId,
				ownerUserId: null,
				ifNoneMatch: null,
			}),
		).resolves.toEqual({ bytes: normalizedBytes, etag: `"${photoId}"`, notModified: false });
		await expect(
			api.getPhoto({
				submissionId: submission.submissionId,
				photoId,
				ownerUserId: null,
				ifNoneMatch: `"${photoId}"`,
			}),
		).resolves.toEqual({ etag: `"${photoId}"`, notModified: true });
		await expect(
			api.getPhoto({
				submissionId: submission.submissionId,
				photoId,
				ownerUserId: null,
				ifNoneMatch: `W/"${photoId}", "other"`,
			}),
		).resolves.toEqual({ etag: `"${photoId}"`, notModified: true });
		await expect(
			api.getPhoto({
				submissionId: "other-parent",
				photoId,
				ownerUserId: null,
				ifNoneMatch: null,
			}),
		).rejects.toMatchObject({ code: "dining_submission_photo_not_found" });
		await expect(
			api.getPhoto({
				submissionId: submission.submissionId,
				photoId,
				ownerUserId: "other-owner",
				ifNoneMatch: `"${photoId}"`,
			}),
		).rejects.toMatchObject({ status: 404 });
		await management.query(
			"update dining.submissions set status='hidden',hidden_at=$2,hidden_by='ops',revision=2 where submission_id=$1",
			[submission.submissionId, clock],
		);
		await expect(
			api.getPhoto({
				submissionId: submission.submissionId,
				photoId,
				ownerUserId: null,
				ifNoneMatch: `"${photoId}"`,
			}),
		).rejects.toMatchObject({ status: 404 });
		await expect(
			api.getPhoto({
				submissionId: submission.submissionId,
				photoId,
				ownerUserId: author.principalId,
				ifNoneMatch: null,
			}),
		).resolves.toEqual({ bytes: normalizedBytes, etag: `"${photoId}"`, notModified: false });
		expect((await api.create(input)).submission.status).toBe("hidden");
		expect(images.normalize).toHaveBeenCalledTimes(1);
		await api.update({
			actor: author,
			submissionId: submission.submissionId,
			expectedRevision: 2,
			metadata: { ...fields, photoAction: "remove" },
			photo: null,
		});
		await expect(
			api.getPhoto({
				submissionId: submission.submissionId,
				photoId,
				ownerUserId: author.principalId,
				ifNoneMatch: `"${photoId}"`,
			}),
		).rejects.toMatchObject({ status: 404 });
		const oldPhoto = (
			await management.query("select * from dining.submission_photos where photo_id=$1", [photoId])
		).rows[0];
		expect(oldPhoto).toMatchObject({
			current: false,
			cleanup_status: "pending",
			expires_at: new Date(clock.getTime() + 30 * 86400_000),
		});
		expect(objects.deleteAllVersions).not.toHaveBeenCalled();
	});

	it("checks window and account state again after media and prevents non-owner mutation", async () => {
		const created = (await service().create(createInput())).submission;
		const outsider = { principalId: randomUUID(), displayName: "另一同学" };
		await addUser(outsider.principalId);
		await expect(
			service().update({
				actor: outsider,
				submissionId: created.submissionId,
				expectedRevision: 1,
				metadata: { ...fields, photoAction: "keep" },
				photo: null,
			}),
		).rejects.toMatchObject({ status: 404 });
		await expect(
			service().deleteOwn({
				userId: outsider.principalId,
				submissionId: created.submissionId,
				expectedRevision: 1,
			}),
		).rejects.toMatchObject({ status: 404 });
		const put = objects.put;
		objects.put = async (key, photo) => {
			await publish([]);
			return put(key, photo);
		};
		await expect(
			service().create({
				...createInput(),
				metadata: { ...fields, photoAction: "replace" },
				photo: photoBytes,
			}),
		).rejects.toMatchObject({ code: "dining_submission_state_conflict" });
		expect(stored.size).toBe(0);
		await expect(
			service().getPublic({ submissionId: created.submissionId, viewerUserId: null }),
		).rejects.toMatchObject({ status: 404 });
		expect(
			(await service().getOwn({ userId: author.principalId, submissionId: created.submissionId }))
				.submission,
		).toMatchObject({ windowAvailable: false, canEdit: false, canDelete: true });
		await publish([windowId]);
		objects.put = async (key, photo) => {
			await pool.query('update app_auth."user" set banned=true where id=$1', [author.principalId]);
			return put(key, photo);
		};
		await expect(
			service().create({
				...createInput(),
				metadata: { ...fields, photoAction: "replace" },
				photo: photoBytes,
			}),
		).rejects.toMatchObject({ code: "BANNED_USER", status: 403 });
		expect(stored.size).toBe(0);
		// Ordinary banning prevents writes but is not an additional public-hide rule.
		await expect(
			service().getPublic({ submissionId: created.submissionId, viewerUserId: null }),
		).resolves.toHaveProperty("submission");
		await management.query(
			`insert into profile.account_deletion_requests (request_id,owner_user_id,status,requested_at,next_attempt_at,updated_at)
			values ($1,$2,'pending',$3,$3,$3)`,
			[randomUUID(), author.principalId, clock],
		);
		await expect(
			service().getPublic({ submissionId: created.submissionId, viewerUserId: null }),
		).rejects.toMatchObject({ status: 404 });
	});

	it("rejects stale photo updates after processing and cleans only the unused object", async () => {
		const api = service();
		const { submission } = await api.create(createInput());
		const put = objects.put;
		objects.put = async (key, photo) => {
			await api.update({
				actor: author,
				submissionId: submission.submissionId,
				expectedRevision: 1,
				metadata: { ...fields, name: "另一标签页修改", photoAction: "keep" },
				photo: null,
			});
			return put(key, photo);
		};
		await expect(
			api.update({
				actor: author,
				submissionId: submission.submissionId,
				expectedRevision: 1,
				metadata: { ...fields, photoAction: "replace" },
				photo: photoBytes,
			}),
		).rejects.toMatchObject({ status: 412 });
		expect(stored.size).toBe(0);
		expect((await ownRow(submission.submissionId)).name).toBe("另一标签页修改");
	});

	it("retains an uncertain PUT reservation without consuming quota", async () => {
		objects.put = vi.fn(async (key, photo) => {
			stored.set(key, photo.bytes);
			throw new Error("secret endpoint failure");
		});
		objects.deleteAllVersions = vi.fn(async () => {
			throw new Error("secret credentials failure");
		});
		await expect(
			service().create({
				...createInput(),
				metadata: { ...fields, photoAction: "replace" },
				photo: photoBytes,
			}),
		).rejects.toMatchObject({
			code: "dining_submission_storage_unavailable",
			status: 503,
			retryable: true,
		});
		const [key] = stored.keys();
		const orphan = (
			await management.query("select * from dining.submission_photos where object_key=$1", [key])
		).rows[0];
		expect(orphan).toMatchObject({
			submission_id: null,
			current: false,
			cleanup_status: "failed",
			cleanup_attempts: 0,
			cleanup_last_error: "dining_submission_storage_unavailable",
		});
		expect(orphan.cleanup_started_at).toBeNull();
		expect(orphan.expires_at.getTime()).toBeGreaterThan(clock.getTime());
		expect(objects.deleteAllVersions).not.toHaveBeenCalled();
		expect(
			(
				await management.query("select 1 from dining.submissions where author_id=$1", [
					author.principalId,
				])
			).rowCount,
		).toBe(0);
		for (let i = 0; i < 3; i++) {
			await service().create(createInput());
		}
	});

	it("keeps tracking a PUT that finishes remotely after the request fails", async () => {
		let completeRemoteWrite: () => void = () => undefined;
		let pendingKey = "";
		objects.put = vi.fn(async (key, photo) => {
			pendingKey = key;
			completeRemoteWrite = () => {
				stored.set(key, photo.bytes);
			};
			throw new Error("response timed out before remote commit");
		});
		await expect(
			service().create({
				...createInput(),
				metadata: { ...fields, photoAction: "replace" },
				photo: photoBytes,
			}),
		).rejects.toMatchObject({ status: 503 });
		expect(stored.size).toBe(0);
		completeRemoteWrite();
		expect(stored.has(pendingKey)).toBe(true);
		const { rows } = await management.query(
			"select * from dining.submission_photos where object_key=$1",
			[pendingKey],
		);
		expect(rows[0]).toMatchObject({
			current: false,
			submission_id: null,
			cleanup_status: "failed",
			cleanup_started_at: null,
		});
		expect(rows[0].expires_at.getTime()).toBe(clock.getTime() + 5 * 60 * 1000);
		expect(objects.deleteAllVersions).not.toHaveBeenCalled();
	});

	it("retains a known unused upload when immediate compensation fails", async () => {
		objects.put = vi.fn(async (key, photo) => {
			stored.set(key, photo.bytes);
			await publish([]);
			return { versionId: "v1" };
		});
		objects.deleteAllVersions = vi.fn(async () => {
			throw new Error("delete unavailable");
		});
		await expect(
			service().create({
				...createInput(),
				metadata: { ...fields, photoAction: "replace" },
				photo: photoBytes,
			}),
		).rejects.toMatchObject({ status: 409 });
		const [key] = stored.keys();
		const { rows } = await management.query(
			"select * from dining.submission_photos where object_key=$1",
			[key],
		);
		expect(rows[0]).toMatchObject({
			current: false,
			submission_id: null,
			cleanup_status: "failed",
			cleanup_attempts: 1,
			cleanup_last_error: "dining_submission_storage_unavailable",
		});
		expect(objects.deleteAllVersions).toHaveBeenCalledWith(key);
	});

	it("reconciles an uncertain successful commit without deleting its referenced photo", async () => {
		const uncertain = new Proxy(db, {
			get(target, property, receiver) {
				if (property === "transaction") {
					return async (...args: Parameters<RuntimeDatabase["transaction"]>) => {
						const result = await target.transaction(...args);
						if (result && typeof result === "object" && "submission" in result) {
							throw new Error("connection lost after commit");
						}
						return result;
					};
				}
				return Reflect.get(target, property, receiver);
			},
		});
		const input = {
			...createInput(),
			metadata: { ...fields, photoAction: "replace" as const },
			photo: photoBytes,
		};
		await expect(service({ getDb: async () => uncertain }).create(input)).rejects.toMatchObject({
			code: "internal_error",
		});
		const result = await service().create(input);
		expect(result.submission).toHaveProperty("photo");
		expect(stored.size).toBe(1);
		expect(objects.deleteAllVersions).not.toHaveBeenCalled();
		expect(images.normalize).toHaveBeenCalledTimes(1);
	});

	it("cleans a losing same-key upload without touching the winner", async () => {
		let arrivals = 0;
		let release: () => void = () => {
			throw new Error("barrier not initialized");
		};
		const both = new Promise<void>((resolve) => {
			release = resolve;
		});
		const put = objects.put;
		objects.put = async (key, photo) => {
			arrivals += 1;
			if (arrivals === 2) {
				release();
			}
			await both;
			return put(key, photo);
		};
		const input = {
			...createInput(),
			metadata: { ...fields, photoAction: "replace" as const },
			photo: photoBytes,
		};
		const results = await Promise.all([service().create(input), service().create(input)]);
		expect(results[0]).toEqual(results[1]);
		expect(stored.size).toBe(1);
		expect(objects.deleteAllVersions).toHaveBeenCalledTimes(1);
		const row = (
			await management.query("select * from dining.submission_photos where submission_id=$1", [
				results[0]?.submission.submissionId,
			])
		).rows[0];
		expect(row).toMatchObject({
			current: true,
			cleanup_status: "pending",
			cleanup_started_at: null,
			object_version_id: "v1",
			expires_at: null,
		});
	});

	it("binds cursors to the query scope and orders equal creation timestamps by stable ID", async () => {
		const api = service();
		for (let i = 0; i < 3; i++) {
			await api.create(createInput());
		}
		const first = await api.listOwn({ userId: author.principalId, limit: 2 });
		expect(first.items).toHaveLength(2);
		if (!first.nextCursor) {
			throw new Error("cursor missing");
		}
		const second = await api.listOwn({
			userId: author.principalId,
			limit: 2,
			cursor: first.nextCursor,
		});
		expect(second.items).toHaveLength(1);
		expect(new Set([...first.items, ...second.items].map((row) => row.submissionId)).size).toBe(3);
		await expect(
			api.listOwn({ userId: "other-user", limit: 2, cursor: first.nextCursor }),
		).rejects.toMatchObject({ status: 400 });
		await expect(
			api.listPublic({ windowId, viewerUserId: null, limit: 2, cursor: first.nextCursor }),
		).rejects.toMatchObject({ status: 400 });
		const publicPage = await api.listPublic({ windowId, viewerUserId: null, limit: 2 });
		expect(publicPage.items.map((row) => row.submissionId)).toEqual(
			first.items.map((row) => row.submissionId),
		);
	});

	it("uses the raw upload digest for replay before invoking the image processor", async () => {
		const api = service();
		const input = {
			...createInput(),
			metadata: { ...fields, photoAction: "replace" as const },
			photo: photoBytes,
		};
		await api.create(input);
		await expect(api.create({ ...input, photo: new Uint8Array([7, 8, 9]) })).rejects.toMatchObject({
			code: "dining_submission_idempotency_conflict",
		});
		expect(images.normalize).toHaveBeenCalledTimes(1);
		await api.create(input);
		expect(images.normalize).toHaveBeenCalledTimes(1);
	});

	it("refuses to bind an expired upload reservation and recovers its object", async () => {
		const put = objects.put;
		objects.put = async (key, photo) => {
			const result = await put(key, photo);
			clock = new Date(clock.getTime() + 6 * 60_000);
			return result;
		};
		await expect(
			service().create({
				...createInput(),
				metadata: { ...fields, photoAction: "replace" },
				photo: photoBytes,
			}),
		).rejects.toMatchObject({ code: "dining_submission_storage_unavailable" });
		expect(stored.size).toBe(0);
		expect(
			(
				await management.query("select 1 from dining.submissions where author_id=$1", [
					author.principalId,
				])
			).rowCount,
		).toBe(0);
	});

	it("rolls back content and media references before discarding an uncommitted upload", async () => {
		const failing = new Proxy(db, {
			get(target, property, receiver) {
				if (property === "transaction") {
					return async (callback: Parameters<RuntimeDatabase["transaction"]>[0]) =>
						target.transaction(async (tx) => {
							const result = await callback(tx);
							if (result && typeof result === "object" && "submission" in result) {
								throw new Error("database transaction failed before commit");
							}
							return result;
						});
				}
				return Reflect.get(target, property, receiver);
			},
		});
		await expect(
			service({ getDb: async () => failing }).create({
				...createInput(),
				metadata: { ...fields, photoAction: "replace" },
				photo: photoBytes,
			}),
		).rejects.toMatchObject({ code: "internal_error" });
		expect(stored.size).toBe(0);
		expect(objects.deleteAllVersions).toHaveBeenCalledTimes(1);
		expect(
			(
				await management.query("select 1 from dining.submissions where author_id=$1", [
					author.principalId,
				])
			).rowCount,
		).toBe(0);
	});

	it("leaves the media record untouched when the commit outcome cannot be inspected", async () => {
		let unavailable = false;
		const uncertain = new Proxy(db, {
			get(target, property, receiver) {
				if (property === "transaction") {
					return async (...args: Parameters<RuntimeDatabase["transaction"]>) => {
						const result = await target.transaction(...args);
						if (result && typeof result === "object" && "submission" in result) {
							unavailable = true;
							throw new Error("database disconnected");
						}
						return result;
					};
				}
				return Reflect.get(target, property, receiver);
			},
		});
		const input = {
			...createInput(),
			metadata: { ...fields, photoAction: "replace" as const },
			photo: photoBytes,
		};
		await expect(
			service({
				getDb: async () => {
					if (unavailable) {
						throw new Error("database unavailable");
					}
					return uncertain;
				},
			}).create(input),
		).rejects.toMatchObject({ code: "internal_error" });
		expect(stored.size).toBe(1);
		expect(objects.deleteAllVersions).not.toHaveBeenCalled();
		const replay = await service().create(input);
		expect(replay.submission).toHaveProperty("photo");
		expect(images.normalize).toHaveBeenCalledTimes(1);
	});
});
