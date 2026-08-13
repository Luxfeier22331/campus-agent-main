// @vitest-environment node

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { appApiSchema } from "../src/db/schema";
import { createPgAccountAdminStore } from "../src/modules/account-admin";

const postgres = inject("appApiPostgres");
const testEnv = { DEPLOYMENT_ENVIRONMENT: "test" } as const;

describe("account administration PostgreSQL integration", () => {
	let pool: Pool;

	beforeAll(() => {
		pool = new Pool({ connectionString: postgres.runtimeConnectionString, max: 2, ssl: false });
	});

	afterAll(async () => {
		await pool.end();
	});

	it("uses bounded search semantics and counts only active sessions for the selected page", async () => {
		const suffix = Date.now().toString(36);
		const createdAt = new Date("2026-07-20T00:00:00.000Z");
		const activeUntil = new Date(Date.now() + 24 * 60 * 60_000);
		const expiredAt = new Date(Date.now() - 24 * 60 * 60_000);
		const userId = `search-user-${suffix}`;
		const email = `prefix-${suffix}@example.com`;
		await pool.query(
			`insert into "app_auth"."user"
				("id", "name", "email", "emailVerified", "passwordChangeRequired", "createdAt", "updatedAt")
			 values ($1, $4, $2, true, false, $3, $3)`,
			[userId, email, createdAt, `Alpha-${suffix}-Campus`],
		);
		await pool.query(
			`insert into "app_auth"."session"
				("id", "token", "userId", "expiresAt", "createdAt", "updatedAt")
			 values
				($1, $2, $3, $4, $5, $5),
				($6, $7, $3, $8, $5, $5)`,
			[
				`active-session-${suffix}`,
				`active-token-${suffix}`,
				userId,
				activeUntil,
				createdAt,
				`expired-session-${suffix}`,
				`expired-token-${suffix}`,
				expiredAt,
			],
		);
		const database = drizzle(pool, { schema: appApiSchema });
		const store = createPgAccountAdminStore(testEnv, { getDb: async () => database });

		await expect(store.listUsers({ limit: 10, query: userId })).resolves.toMatchObject({
			items: [{ activeSessionCount: 1, id: userId }],
		});
		await expect(store.listUsers({ limit: 10, query: email.toUpperCase() })).resolves.toMatchObject(
			{
				items: [{ id: userId }],
			},
		);
		await expect(store.listUsers({ limit: 10, query: `prefix-${suffix}` })).resolves.toMatchObject({
			items: [{ id: userId }],
		});
		await expect(store.listUsers({ limit: 10, query: `alpha-${suffix}` })).resolves.toMatchObject({
			items: [{ id: userId }],
		});
		await expect(store.listUsers({ limit: 10, query: `${suffix}-Campus` })).resolves.toMatchObject({
			items: [],
		});
	});

	it("keeps cursor pagination stable when users share the same creation time", async () => {
		const suffix = Date.now().toString(36);
		const createdAt = new Date("2026-07-20T01:00:00.000Z");
		for (const letter of ["a", "b", "c"]) {
			await pool.query(
				`insert into "app_auth"."user"
					("id", "name", "email", "emailVerified", "passwordChangeRequired", "createdAt", "updatedAt")
				 values ($1, $2, $3, true, false, $4, $4)`,
				[
					`page-${suffix}-${letter}`,
					`page-${suffix}-${letter}`,
					`page-${suffix}-${letter}@example.com`,
					createdAt,
				],
			);
		}
		const database = drizzle(pool, { schema: appApiSchema });
		const store = createPgAccountAdminStore(testEnv, { getDb: async () => database });
		const first = await store.listUsers({ limit: 2, query: `page-${suffix}` });
		expect(first.items.map((item) => item.id)).toEqual([`page-${suffix}-c`, `page-${suffix}-b`]);
		expect(first.nextCursor).not.toBeNull();
		const second = await store.listUsers({
			...(first.nextCursor ? { cursor: first.nextCursor } : {}),
			limit: 2,
			query: `page-${suffix}`,
		});
		expect(second.items.map((item) => item.id)).toEqual([`page-${suffix}-a`]);
		expect(second.nextCursor).toBeNull();
	});

	it("reports and filters current access independently from account state", async () => {
		const suffix = `${Date.now().toString(36)}-access`;
		const now = new Date("2026-07-20T12:00:00.000Z");
		const users = [
			{
				email: `campus-${suffix}@muc.edu.cn`,
				emailVerified: true,
				id: `access-${suffix}-campus`,
			},
			{
				email: `granted-${suffix}@example.com`,
				emailVerified: true,
				id: `access-${suffix}-granted`,
			},
			{
				email: `denied-${suffix}@example.com`,
				emailVerified: true,
				id: `access-${suffix}-denied`,
			},
			{
				email: `unverified-${suffix}@muc.edu.cn`,
				emailVerified: false,
				id: `access-${suffix}-unverified`,
			},
		] as const;
		for (const record of users) {
			await pool.query(
				`insert into "app_auth"."user"
					("id", "name", "email", "emailVerified", "passwordChangeRequired", "createdAt", "updatedAt")
				 values ($1, $1, $2, $3, false, $4, $4)`,
				[record.id, record.email, record.emailVerified, now],
			);
		}
		await pool.query(
			`insert into "app_auth"."email_access_grant"
				("claim_expires_at", "claimed_at", "created_at", "created_by", "email", "environment",
				 "id", "kind", "state", "updated_at", "user_id")
			 values ($1, $2, $2, 'ops@example.test', $3, 'test', $4, 'invitation', 'active', $2, $5)`,
			[new Date("2026-07-21T00:00:00.000Z"), now, users[1].email, `grant-${suffix}`, users[1].id],
		);

		const database = drizzle(pool, { schema: appApiSchema });
		const store = createPgAccountAdminStore(testEnv, {
			getDb: async () => database,
			now: () => now,
		});
		await expect(store.getUser(users[0].id)).resolves.toMatchObject({
			accessSource: "campus_email",
			accessState: "allowed",
		});
		await expect(store.getUser(users[1].id)).resolves.toMatchObject({
			accessSource: "email_grant",
			accessState: "allowed",
		});
		await expect(store.getUser(users[2].id)).resolves.toMatchObject({
			accessSource: null,
			accessState: "denied",
		});
		await expect(store.getUser(users[3].id)).resolves.toMatchObject({
			accessSource: null,
			accessState: "denied",
		});

		const allowed = await store.listUsers({
			access: "allowed",
			limit: 10,
			query: `access-${suffix}`,
		});
		expect(allowed.items.map((item) => item.id).sort()).toEqual([users[0].id, users[1].id].sort());
		expect(allowed.items.every((item) => item.state === "active")).toBe(true);
		const denied = await store.listUsers({
			access: "denied",
			limit: 10,
			query: `access-${suffix}`,
		});
		expect(denied.items.map((item) => item.id).sort()).toEqual([users[2].id, users[3].id].sort());
	});

	it("does not unban an account while deletion is pending", async () => {
		const suffix = `${Date.now().toString(36)}-unban`;
		const now = new Date("2026-07-20T12:00:00.000Z");
		const userId = `unban-user-${suffix}`;
		await pool.query(
			`insert into "app_auth"."user"
				("id", "name", "email", "emailVerified", "banned", "passwordChangeRequired", "createdAt", "updatedAt")
			 values ($1, $1, $2, true, true, false, $3, $3)`,
			[userId, `${userId}@muc.edu.cn`, now],
		);
		await pool.query(
			`insert into "profile"."account_deletion_requests"
				("next_attempt_at", "owner_user_id", "request_id", "requested_at", "status", "updated_at")
			 values ($1, $2, $3, $1, 'pending', $1)`,
			[now, userId, `unban-request-${suffix}`],
		);
		const database = drizzle(pool, { schema: appApiSchema });
		const store = createPgAccountAdminStore(testEnv, {
			getDb: async () => database,
		});

		await expect(store.unbanUser(userId, now)).resolves.toBe("deleting");
		const result = await pool.query<{ banned: boolean }>(
			`select "banned" from "app_auth"."user" where "id" = $1`,
			[userId],
		);
		expect(result.rows[0]?.banned).toBe(true);
	});

	it("marks only stale started commands as indeterminate", async () => {
		const suffix = Date.now().toString(36);
		await pool.query(
			`insert into "app_auth"."account_admin_event"
				("action", "actor_id", "event_id", "idempotency_key", "occurred_at", "outcome",
				 "request_fingerprint")
			 values
				('account_banned', 'ops@example.test', $1, $2, '2026-07-20T00:00:00Z', 'started', $3),
				('account_banned', 'ops@example.test', $4, $5, '2026-07-20T01:00:00Z', 'started', $3)`,
			[
				`stale-event-${suffix}`,
				`stale-key-${suffix}`,
				"f".repeat(64),
				`recent-event-${suffix}`,
				`recent-key-${suffix}`,
			],
		);
		const database = drizzle(pool, { schema: appApiSchema });
		const store = createPgAccountAdminStore(testEnv, { getDb: async () => database });
		await expect(
			store.markStaleCommandsIndeterminate(new Date("2026-07-20T00:30:00.000Z")),
		).resolves.toBe(1);
		const states = await pool.query<{ error_code: string | null; outcome: string }>(
			`select "error_code", "outcome"
			 from "app_auth"."account_admin_event"
			 where "event_id" in ($1, $2)
			 order by "event_id"`,
			[`recent-event-${suffix}`, `stale-event-${suffix}`],
		);
		expect(states.rows).toEqual([
			{ error_code: null, outcome: "started" },
			{ error_code: "audit_finalization_timeout", outcome: "indeterminate" },
		]);
	});

	it("installs the user lookup and active-session indexes", async () => {
		const indexes = await pool.query<{ indexname: string }>(
			`select indexname
			 from pg_indexes
			 where schemaname = 'app_auth'
			   and indexname in (
				'user_created_at_id_idx',
				'user_email_prefix_idx',
				'user_name_prefix_idx',
				'session_user_id_expires_at_idx'
			   )
			 order by indexname`,
		);
		expect(indexes.rows.map((row) => row.indexname)).toEqual([
			"session_user_id_expires_at_idx",
			"user_created_at_id_idx",
			"user_email_prefix_idx",
			"user_name_prefix_idx",
		]);
	});
});
