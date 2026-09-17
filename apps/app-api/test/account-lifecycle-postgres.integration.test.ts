// @vitest-environment node

import { drizzle } from "drizzle-orm/node-postgres";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { createPgAccountLifecycleStore } from "../src/modules/account-lifecycle";

const postgres = inject("appApiPostgres");

describe("account lifecycle PostgreSQL integration", () => {
	let client: Client;
	let pool: Pool;

	beforeAll(async () => {
		client = new Client({ connectionString: postgres.runtimeConnectionString, ssl: false });
		await client.connect();
		pool = new Pool({ connectionString: postgres.runtimeConnectionString, max: 2, ssl: false });
	});

	afterAll(async () => {
		await client.end();
		await pool.end();
	});

	it("fences credentials and completes deletion only after owned data is erased", async () => {
		const suffix = Date.now().toString(36);
		const userId = `account-delete-user-${suffix}`;
		const requestId = `account-delete-${suffix}`;
		const now = new Date("2026-07-19T00:00:00.000Z");
		const expiresAt = new Date("2026-07-20T00:00:00.000Z");

		await client.query(
			`insert into "app_auth"."user"
				("id", "name", "email", "emailVerified", "banned", "passwordChangeRequired", "createdAt", "updatedAt")
			 values ($1, 'Campus User', $2, true, false, false, $3, $3)`,
			[userId, `account-delete-${suffix}@muc.edu.cn`, now],
		);
		await client.query(
			`insert into "app_auth"."session"
				("id", "token", "userId", "expiresAt", "createdAt", "updatedAt")
			 values ($1, $2, $3, $4, $5, $5)`,
			[`session-${suffix}`, `session-token-${suffix}`, userId, expiresAt, now],
		);
		await client.query(
			`insert into "profile"."memory_settings"
				("owner_user_id", "lifecycle_state", "sync_status", "updated_at")
			 values ($1, 'active', 'synced', $2)`,
			[userId, now],
		);
		await client.query(
			`insert into "chat"."conversations"
				("id", "owner_user_id", "title", "created_at", "updated_at")
			 values ($1, $2, 'Private conversation', $3, $3)`,
			[`conversation-${suffix}`, userId, now],
		);
		const safetyIdentifier = `safety-${suffix}`;
		await client.query(
			`insert into "runtime"."request_observability_fact"
				("request_id", "safety_identifier", "conversation_id", "surface",
				 "principal_type", "status", "started_at", "measured_at", "updated_at")
			 values
				($1, 'other-user', $2, 'campus-web', 'campus_member', 'completed', $4, $4, $4),
				($3, $5, 'other-conversation', 'campus-web', 'campus_member', 'completed', $4, $4, $4)`,
			[
				`request-conversation-${suffix}`,
				`conversation-${suffix}`,
				`request-safety-${suffix}`,
				now,
				safetyIdentifier,
			],
		);
		await client.query(
			`insert into "app_auth"."verification"
				("id", "identifier", "value", "expiresAt", "createdAt", "updatedAt")
			 values ($1, $2, $3, $4, $5, $5)`,
			[`verification-${suffix}`, `reset-password:token-${suffix}`, userId, expiresAt, now],
		);

		const database = drizzle({ client: client });
		const store = createPgAccountLifecycleStore({ getDb: async () => database });
		await expect(
			store.requestDeletion({ ownerUserId: userId, requestId, requestedAt: now }),
		).resolves.toEqual({ requestId, status: "deleting" });

		const fenced = await client.query<{ banned: boolean; sessions: string }>(
			`select u."banned",
				(select count(*)::text from "app_auth"."session" where "userId" = $1) as sessions
			 from "app_auth"."user" u where u."id" = $1`,
			[userId],
		);
		expect(fenced.rows[0]).toEqual({ banned: true, sessions: "0" });

		const leaseToken = `lease-${suffix}`;
		const [claimed] = await store.claimPending({
			leaseExpiresAt: new Date("2026-07-19T00:05:00.000Z"),
			leaseToken,
			limit: 1,
			now,
		});
		expect(claimed).toEqual({ leaseToken, ownerUserId: userId, requestId });
		if (!claimed) {
			throw new Error("Expected the deletion request to be claimed.");
		}

		await store.deleteOwnedData(claimed, new Date("2026-07-19T00:01:00.000Z"), safetyIdentifier);
		expect(
			(
				await client.query(`select 1 from "chat"."conversations" where "owner_user_id" = $1`, [
					userId,
				])
			).rowCount,
		).toBe(1);

		await client.query(
			`update "profile"."memory_settings"
			 set "lifecycle_state" = 'erased', "sync_status" = 'synced', "updated_at" = $2
			 where "owner_user_id" = $1`,
			[userId, now],
		);
		await store.deleteOwnedData(claimed, new Date("2026-07-19T00:02:00.000Z"), safetyIdentifier);
		expect(
			(
				await client.query(`select 1 from "chat"."conversations" where "owner_user_id" = $1`, [
					userId,
				])
			).rowCount,
		).toBe(0);
		expect(
			(
				await client.query(
					`select 1 from "runtime"."request_observability_fact" where "request_id" in ($1, $2)`,
					[`request-conversation-${suffix}`, `request-safety-${suffix}`],
				)
			).rowCount,
		).toBe(0);
		expect(
			(await client.query(`select 1 from "app_auth"."verification" where "value" = $1`, [userId]))
				.rowCount,
		).toBe(0);

		// Better Auth owns the final auth-account removal between these two store operations.
		await client.query(`delete from "app_auth"."user" where "id" = $1`, [userId]);
		await store.completeDeletion(claimed, new Date("2026-07-19T00:03:00.000Z"));

		const receipt = await client.query<{ ownerUserId: string | null; status: string }>(
			`select "owner_user_id" as "ownerUserId", "status"
			 from "profile"."account_deletion_requests" where "request_id" = $1`,
			[requestId],
		);
		expect(receipt.rows[0]).toEqual({ ownerUserId: null, status: "completed" });
		expect(
			(
				await client.query(`select 1 from "profile"."memory_settings" where "owner_user_id" = $1`, [
					userId,
				])
			).rowCount,
		).toBe(0);
	});

	it("accepts Dining deletion atomically and blocks completion while a photo remains", async () => {
		const suffix = `${Date.now().toString(36)}-dining`;
		const userId = `account-delete-user-${suffix}`;
		const requestId = `account-delete-${suffix}`;
		const submissionId = `account-submission-${suffix}`;
		const photoId = `account-photo-${suffix}`;
		const now = new Date("2026-07-19T00:00:00.000Z");
		await client.query(
			`insert into app_auth."user"
				(id, name, email, "emailVerified", "banned", "passwordChangeRequired", "createdAt", "updatedAt")
			 values ($1, 'Campus User', $2, true, false, false, $3, $3)`,
			[userId, `${suffix}@muc.edu.cn`, now],
		);
		await client.query(
			`insert into profile.memory_settings
				(owner_user_id, lifecycle_state, sync_status, updated_at)
			 values ($1, 'erased', 'synced', $2)`,
			[userId, now],
		);
		await client.query(
			`insert into dining.submissions
				(submission_id, author_id, author_display_name, name, status, revision,
				 content_revision, created_submission_date, created_at, updated_at)
			 values ($1, $2, 'Campus User', 'Original dish', 'public', 1, 1, '2026-07-19', $3, $3)`,
			[submissionId, userId, now],
		);
		await client.query(
			`insert into dining.submission_photos
				(photo_id, submission_id, object_key, width, height, current, cleanup_status)
			 values ($1, $2, $3, 20, 20, true, 'pending')`,
			[photoId, submissionId, `dining/submissions/${photoId}.webp`],
		);
		const database = drizzle({ client: pool });
		const store = createPgAccountLifecycleStore({ getDb: async () => database });
		await store.requestDeletion({ ownerUserId: userId, requestId, requestedAt: now });
		expect(
			(
				await client.query(
					`select account_deleting_at, account_deletion_request_id
			 from dining.submissions where submission_id = $1`,
					[submissionId],
				)
			).rows[0],
		).toEqual({ account_deleting_at: now, account_deletion_request_id: requestId });
		const [claimed] = await store.claimPending({
			leaseExpiresAt: new Date("2026-07-19T00:05:00.000Z"),
			leaseToken: `lease-${suffix}`,
			limit: 1,
			now,
		});
		if (!claimed || claimed.requestId !== requestId) {
			throw new Error("Expected the Dining deletion request to be claimed.");
		}
		const attemptAt = new Date("2026-07-19T00:01:00.000Z");
		await expect(store.deleteOwnedData(claimed, attemptAt, null)).resolves.toBe(false);
		await expect(store.completeDeletion(claimed, attemptAt)).resolves.toBe(false);

		// A scrubbed parent does not prove that its object's version bytes have been deleted.
		await client.query(
			`update dining.submissions
			 set author_id = null, author_display_name = null, name = null,
			     status = 'purged', purged_at = $2 where submission_id = $1`,
			[submissionId, attemptAt],
		);
		await expect(store.deleteOwnedData(claimed, attemptAt, null)).resolves.toBe(false);
		await expect(store.completeDeletion(claimed, attemptAt)).resolves.toBe(false);
		expect(
			(
				await client.query(
					"select status, owner_user_id from profile.account_deletion_requests where request_id = $1",
					[requestId],
				)
			).rows[0],
		).toEqual({ status: "pending", owner_user_id: userId });
		expect(
			(await client.query(`select 1 from app_auth."user" where id = $1`, [userId])).rowCount,
		).toBe(1);

		// Simulate the Dining owner's post-byte-deletion metadata cleanup.
		await client.query("delete from dining.submission_photos where photo_id = $1", [photoId]);
		await client.query("delete from dining.submissions where submission_id = $1", [submissionId]);
		await expect(store.deleteOwnedData(claimed, attemptAt, null)).resolves.toBe(true);
		await client.query(`delete from app_auth."user" where id = $1`, [userId]);
		await expect(store.completeDeletion(claimed, attemptAt)).resolves.toBe(true);
	});

	it("claims each pending deletion once and recovers an expired lease", async () => {
		const suffix = `${Date.now().toString(36)}-lease`;
		const userId = `account-delete-user-${suffix}`;
		const requestId = `account-delete-${suffix}`;
		const now = new Date("2026-07-19T00:00:00.000Z");
		await client.query(
			`insert into "app_auth"."user"
				("id", "name", "email", "emailVerified", "banned", "passwordChangeRequired", "createdAt", "updatedAt")
			 values ($1, 'Campus User', $2, true, false, false, $3, $3)`,
			[userId, `${suffix}@muc.edu.cn`, now],
		);
		const database = drizzle({ client: pool });
		const store = createPgAccountLifecycleStore({ getDb: async () => database });
		await store.requestDeletion({ ownerUserId: userId, requestId, requestedAt: now });

		const [firstAttempt, secondAttempt] = await Promise.all([
			store.claimPending({
				leaseExpiresAt: new Date("2026-07-19T00:05:00.000Z"),
				leaseToken: "lease-first",
				limit: 1,
				now,
			}),
			store.claimPending({
				leaseExpiresAt: new Date("2026-07-19T00:05:00.000Z"),
				leaseToken: "lease-concurrent",
				limit: 1,
				now,
			}),
		]);
		const claims = [...firstAttempt, ...secondAttempt];
		expect(claims).toHaveLength(1);
		const first = claims[0];
		if (!first) {
			throw new Error("Expected one concurrent deletion claim.");
		}
		await expect(
			store.defer(
				first,
				new Date("2026-07-19T00:07:00.000Z"),
				new Date("2026-07-19T00:06:00.000Z"),
			),
		).resolves.toBe(false);

		const recovered = await store.claimPending({
			leaseExpiresAt: new Date("2026-07-19T00:11:00.000Z"),
			leaseToken: "lease-recovered",
			limit: 1,
			now: new Date("2026-07-19T00:06:00.000Z"),
		});
		expect(recovered).toEqual([{ leaseToken: "lease-recovered", ownerUserId: userId, requestId }]);
		const recoveredRequest = recovered[0];
		if (!recoveredRequest) {
			throw new Error("Expected the expired lease to be recovered.");
		}
		await expect(
			store.defer(
				first,
				new Date("2026-07-19T00:07:00.000Z"),
				new Date("2026-07-19T00:06:00.000Z"),
			),
		).resolves.toBe(false);
		await expect(
			store.defer(
				recoveredRequest,
				new Date("2099-01-01T00:00:00.000Z"),
				new Date("2026-07-19T00:07:00.000Z"),
			),
		).resolves.toBe(true);
	});

	it("keeps a renewed lease owned by one worker until its new expiry", async () => {
		const suffix = `${Date.now().toString(36)}-renew`;
		const userId = `account-delete-user-${suffix}`;
		const requestId = `account-delete-${suffix}`;
		const startedAt = new Date("2026-07-19T01:00:00.000Z");
		await client.query(
			`insert into "app_auth"."user"
				("id", "name", "email", "emailVerified", "banned", "passwordChangeRequired", "createdAt", "updatedAt")
			 values ($1, 'Campus User', $2, true, false, false, $3, $3)`,
			[userId, `${suffix}@muc.edu.cn`, startedAt],
		);
		const database = drizzle({ client: pool });
		const store = createPgAccountLifecycleStore({ getDb: async () => database });
		await store.requestDeletion({ ownerUserId: userId, requestId, requestedAt: startedAt });
		const [claimed] = await store.claimPending({
			leaseExpiresAt: new Date("2026-07-19T01:05:00.000Z"),
			leaseToken: "lease-renewed",
			limit: 1,
			now: startedAt,
		});
		if (!claimed) {
			throw new Error("Expected the deletion request to be claimed.");
		}
		expect(claimed.requestId).toBe(requestId);
		await expect(
			store.renewLease(
				claimed,
				new Date("2026-07-19T01:10:00.000Z"),
				new Date("2026-07-19T01:04:00.000Z"),
			),
		).resolves.toBe(true);
		const renewed = await pool.query<{ leaseExpiresAt: Date; leaseToken: string }>(
			`select "lease_expires_at" as "leaseExpiresAt", "lease_token" as "leaseToken"
			 from "profile"."account_deletion_requests" where "request_id" = $1`,
			[requestId],
		);
		expect(renewed.rows[0]).toEqual({
			leaseExpiresAt: new Date("2026-07-19T01:10:00.000Z"),
			leaseToken: "lease-renewed",
		});
		await expect(
			store.claimPending({
				leaseExpiresAt: new Date("2026-07-19T01:11:00.000Z"),
				leaseToken: "lease-competitor",
				limit: 1,
				now: new Date("2026-07-19T01:06:00.000Z"),
			}),
		).resolves.toEqual([]);
		const recovered = await store.claimPending({
			leaseExpiresAt: new Date("2026-07-19T01:16:00.000Z"),
			leaseToken: "lease-recovered",
			limit: 1,
			now: new Date("2026-07-19T01:11:00.000Z"),
		});
		expect(recovered).toEqual([{ leaseToken: "lease-recovered", ownerUserId: userId, requestId }]);
		await expect(
			store.claimPending({
				leaseExpiresAt: new Date("2026-07-19T01:17:00.000Z"),
				leaseToken: "lease-third",
				limit: 1,
				now: new Date("2026-07-19T01:12:00.000Z"),
			}),
		).resolves.toEqual([]);
		await expect(
			store.renewLease(
				claimed,
				new Date("2026-07-19T01:20:00.000Z"),
				new Date("2026-07-19T01:12:00.000Z"),
			),
		).resolves.toBe(false);
		const recoveredRequest = recovered[0];
		if (!recoveredRequest) {
			throw new Error("Expected the renewed lease to be recovered.");
		}
		await expect(
			store.defer(
				recoveredRequest,
				new Date("2099-01-01T00:00:00.000Z"),
				new Date("2026-07-19T01:12:00.000Z"),
			),
		).resolves.toBe(true);
	});

	it("replays owned-data cleanup after the auth user is already absent", async () => {
		const suffix = `${Date.now().toString(36)}-replay`;
		const userId = `account-delete-user-${suffix}`;
		const requestId = `account-delete-${suffix}`;
		const now = new Date("2026-07-19T02:00:00.000Z");
		const conversationId = `conversation-${suffix}`;
		await client.query(
			`insert into "app_auth"."user"
				("id", "name", "email", "emailVerified", "passwordChangeRequired", "createdAt", "updatedAt")
			 values ($1, 'Campus User', $2, true, false, $3, $3)`,
			[userId, `${suffix}@muc.edu.cn`, now],
		);
		await client.query(
			`insert into "profile"."memory_settings"
				("owner_user_id", "lifecycle_state", "sync_status", "updated_at")
			 values ($1, 'erased', 'synced', $2)`,
			[userId, now],
		);
		await client.query(
			`insert into "chat"."conversations"
				("id", "owner_user_id", "title", "created_at", "updated_at")
			 values ($1, $2, 'Replay cleanup', $3, $3)`,
			[conversationId, userId, now],
		);
		await client.query(
			`insert into "runtime"."request_observability_fact"
				("request_id", "conversation_id", "surface", "principal_type", "status",
				 "started_at", "measured_at", "updated_at")
			 values ($1, $2, 'campus-web', 'campus_member', 'completed', $3, $3, $3)`,
			[`request-${suffix}`, conversationId, now],
		);
		const database = drizzle({ client: pool });
		const store = createPgAccountLifecycleStore({ getDb: async () => database });
		await store.requestDeletion({ ownerUserId: userId, requestId, requestedAt: now });
		const [claimed] = await store.claimPending({
			leaseExpiresAt: new Date("2026-07-19T02:05:00.000Z"),
			leaseToken: "lease-replay",
			limit: 1,
			now,
		});
		if (!claimed || claimed.requestId !== requestId) {
			throw new Error("Expected the replay deletion request to be claimed.");
		}
		await client.query(`delete from "app_auth"."user" where "id" = $1`, [userId]);

		await expect(
			store.deleteOwnedData(claimed, new Date("2026-07-19T02:01:00.000Z"), null),
		).resolves.toBe(true);
		expect(
			(
				await client.query(
					`select 1 from "runtime"."request_observability_fact" where "request_id" = $1`,
					[`request-${suffix}`],
				)
			).rowCount,
		).toBe(0);
		expect(
			(await client.query(`select 1 from "chat"."conversations" where "id" = $1`, [conversationId]))
				.rowCount,
		).toBe(0);
	});
});
