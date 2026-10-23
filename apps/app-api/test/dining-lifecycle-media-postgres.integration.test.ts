// @vitest-environment node
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it, vi } from "vitest";
import type { RuntimeDatabase } from "../src/db/runtime";
import { diningSubmissionPhotos, diningSubmissions } from "../src/db/schema";
import {
	createDiningMediaCleanup,
	DINING_PHOTO_CLEANUP_LEASE_MS,
} from "../src/modules/dining/lifecycle-media";
import type { DiningSubmissionObjects } from "../src/modules/dining/submission-media";
import { bindSubmissionPhoto } from "../src/modules/dining/submission-store-media";

const postgres = inject("appApiPostgres");

describe("Dining media lifecycle with app_api PostgreSQL grants", () => {
	let pool: Pool;
	let db: RuntimeDatabase;
	let now: Date;
	let requestId: string;
	let objects: DiningSubmissionObjects;
	let stored: Set<string>;

	beforeAll(() => {
		pool = new Pool({ connectionString: postgres.runtimeConnectionString, max: 8, ssl: false });
		db = drizzle({ client: pool });
	});
	afterAll(async () => pool.end());
	beforeEach(() => {
		now = new Date("2026-10-01T00:00:00Z");
		requestId = randomUUID();
		stored = new Set();
		objects = {
			put: vi.fn(),
			get: vi.fn(),
			deleteAllVersions: vi.fn(async (key) => {
				stored.delete(key);
			}),
		};
	});

	function cleanup() {
		return createDiningMediaCleanup({
			getDb: async () => db,
			now: () => now,
			objects: () => objects,
		});
	}
	function sweep() {
		return cleanup().sweep({ accountDeletionRequestId: requestId });
	}
	async function parent(values: Partial<typeof diningSubmissions.$inferInsert> = {}) {
		const id = randomUUID();
		await db.insert(diningSubmissions).values({
			submissionId: id,
			status: "public",
			name: "菜名",
			revision: 1,
			contentRevision: 1,
			createdAt: now,
			updatedAt: now,
			createdSubmissionDate: "2026-10-01",
			...values,
		});
		return id;
	}
	async function photo(values: Partial<typeof diningSubmissionPhotos.$inferInsert> = {}) {
		const id = randomUUID();
		const objectKey = `dining/submissions/${id}.webp`;
		stored.add(objectKey);
		const [row] = await db
			.insert(diningSubmissionPhotos)
			.values({
				photoId: id,
				objectKey,
				width: 1,
				height: 1,
				current: false,
				cleanupStatus: "pending",
				accountDeletionRequestId: requestId,
				expiresAt: now,
				...values,
			})
			.returning();
		if (!row) {
			throw new Error("Photo insert failed");
		}
		return row;
	}
	async function record(photoId: string) {
		return (await pool.query("select * from dining.submission_photos where photo_id=$1", [photoId]))
			.rows[0];
	}

	it("keeps current public/hidden media and unexpired retired/orphan media until the UTC boundary", async () => {
		for (const status of ["public", "hidden"]) {
			await photo({ submissionId: await parent({ status }), current: true });
		}
		const expiry = new Date(now.getTime() + 1);
		const retired = await photo({ submissionId: await parent(), expiresAt: expiry });
		const orphan = await photo({ expiresAt: expiry });
		expect(await sweep()).toEqual({ completed: 0, failed: 0, pending: 4 });
		expect(objects.deleteAllVersions).not.toHaveBeenCalled();
		now = expiry;
		expect(await sweep()).toEqual({ completed: 2, failed: 0, pending: 2 });
		expect(await record(retired.photoId)).toBeUndefined();
		expect(await record(orphan.photoId)).toBeUndefined();
		expect(stored.size).toBe(2);
	});

	it("clears current objects when a parent expires, is purged or enters account deletion", async () => {
		for (const state of [
			{ status: "deleted", expiresAt: now },
			{ status: "expired", expiresAt: now, name: null },
			{ status: "purged", purgedAt: now },
			{ accountDeletingAt: now, accountDeletionRequestId: requestId },
		]) {
			await photo({
				submissionId: await parent(state),
				current: true,
				expiresAt: new Date(now.getTime() + 30 * 86400_000),
			});
		}
		expect(await sweep()).toEqual({ completed: 4, failed: 0, pending: 0 });
		expect(stored.size).toBe(0);
	});

	it("retains a failed record and continues other objects, then resumes without keeping an object ledger", async () => {
		const failed = await photo();
		await photo();
		objects.deleteAllVersions = vi.fn(async (key) => {
			if (key === failed.objectKey) {
				throw new Error("unavailable");
			}
			stored.delete(key);
		});
		expect(await sweep()).toEqual({ completed: 1, failed: 1, pending: 1 });
		expect(await record(failed.photoId)).toMatchObject({
			cleanup_status: "failed",
			cleanup_attempts: 1,
			cleanup_last_error: "dining_submission_storage_unavailable",
		});
		objects.deleteAllVersions = vi.fn(async (key) => {
			stored.delete(key);
		});
		expect(await sweep()).toEqual({ completed: 1, failed: 0, pending: 0 });
		expect(await sweep()).toEqual({ completed: 0, failed: 0, pending: 0 });
		expect(objects.deleteAllVersions).toHaveBeenCalledTimes(1);
	});

	it("resumes a crashed claim only after the lease and rejects any later binding", async () => {
		const interrupted = await photo({
			cleanupStatus: "running",
			cleanupStartedAt: now,
			cleanupAttempts: 2,
		});
		expect(await sweep()).toEqual({ completed: 0, failed: 0, pending: 1 });
		now = new Date(now.getTime() + DINING_PHOTO_CLEANUP_LEASE_MS);
		objects.deleteAllVersions = vi.fn(async () => {
			expect(await record(interrupted.photoId)).toMatchObject({
				cleanup_attempts: 3,
				cleanup_status: "running",
			});
			await expect(
				db.transaction((tx) => bindSubmissionPhoto(tx, interrupted, randomUUID(), now)),
			).rejects.toMatchObject({ code: "dining_submission_storage_unavailable" });
		});
		expect(await sweep()).toEqual({ completed: 1, failed: 0, pending: 0 });
	});

	it("keeps a bounded batch fair when an older object repeatedly fails", async () => {
		const failed = await photo({
			cleanupStatus: "failed",
			cleanupStartedAt: new Date(now.getTime() - 86400_000),
		});
		const pending = await photo();
		objects.deleteAllVersions = vi.fn(async (key) => {
			if (key === failed.objectKey) {
				throw new Error("unavailable");
			}
		});
		expect(await cleanup().sweep({ accountDeletionRequestId: requestId, limit: 1 })).toEqual({
			completed: 1,
			failed: 0,
			pending: 1,
		});
		expect(await record(pending.photoId)).toBeUndefined();
		expect(await sweep()).toEqual({ completed: 0, failed: 1, pending: 1 });
	});

	it("rechecks recovery after taking the parent lock and performs object deletion outside the transaction", async () => {
		const submissionId = await parent({ status: "deleted", expiresAt: now });
		const current = await photo({ submissionId, current: true });
		const restoredDb: RuntimeDatabase = new Proxy(db, {
			get(target, property) {
				if (property !== "transaction") {
					return Reflect.get(target, property);
				}
				return async (work: Parameters<RuntimeDatabase["transaction"]>[0]) => {
					await pool.query(
						"update dining.submissions set status='public', expires_at=null where submission_id=$1",
						[submissionId],
					);
					return db.transaction(work);
				};
			},
		});
		const restored = createDiningMediaCleanup({
			getDb: async () => restoredDb,
			now: () => now,
			objects: () => objects,
		});
		expect(await restored.sweep({ accountDeletionRequestId: requestId })).toEqual({
			completed: 0,
			failed: 0,
			pending: 1,
		});
		expect(objects.deleteAllVersions).not.toHaveBeenCalled();
		await pool.query(
			"update dining.submissions set status='deleted', expires_at=$2 where submission_id=$1",
			[submissionId, now],
		);
		objects.deleteAllVersions = vi.fn(async () => {
			const other = await pool.connect();
			try {
				await other.query("begin");
				await other.query(
					"select 1 from dining.submissions where submission_id=$1 for update nowait",
					[submissionId],
				);
				await other.query(
					"select 1 from dining.submission_photos where photo_id=$1 for update nowait",
					[current.photoId],
				);
				await other.query("rollback");
			} finally {
				other.release();
			}
		});
		expect(await sweep()).toEqual({ completed: 1, failed: 0, pending: 0 });
	});

	it("does not let a superseded worker finalize a new claim or report an account complete", async () => {
		const item = await photo();
		let completeFirst!: () => void;
		let startedFirst!: () => void;
		const started = new Promise<void>((resolve) => {
			startedFirst = resolve;
		});
		const first = new Promise<void>((resolve) => {
			completeFirst = resolve;
		});
		let call = 0;
		objects.deleteAllVersions = vi.fn(async () => {
			call += 1;
			if (call === 1) {
				startedFirst();
				await first;
			} else {
				throw new Error("second worker failed");
			}
		});
		const oldWorker = sweep();
		await started;
		now = new Date(now.getTime() + DINING_PHOTO_CLEANUP_LEASE_MS);
		expect(await sweep()).toEqual({ completed: 0, failed: 1, pending: 1 });
		completeFirst();
		expect(await oldWorker).toEqual({ completed: 0, failed: 0, pending: 1 });
		expect(await record(item.photoId)).toMatchObject({
			cleanup_status: "failed",
			cleanup_attempts: 2,
		});
	});
});
