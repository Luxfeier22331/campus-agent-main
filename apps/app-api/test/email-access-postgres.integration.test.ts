// @vitest-environment node

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import {
	buildEmailAccessService,
	createPgEmailAccessGrantStore,
} from "../src/modules/email-access";

const postgres = inject("appApiPostgres");

describe("email access PostgreSQL integration", () => {
	let pool: Pool;

	beforeAll(() => {
		pool = new Pool({ connectionString: postgres.runtimeConnectionString, max: 2, ssl: false });
	});

	afterAll(async () => {
		await pool.end();
	});

	it("claims an exact invitation and revokes credentials without suspending the account", async () => {
		const suffix = Date.now().toString(36);
		const now = new Date("2026-07-19T00:00:00.000Z");
		const email = `invited-${suffix}@example.com`;
		const userId = `invited-user-${suffix}`;
		await pool.query(
			`insert into "app_auth"."user"
				("id", "name", "email", "emailVerified", "banned", "passwordChangeRequired", "createdAt", "updatedAt")
			 values ($1, 'Invited User', $2, false, false, false, $3, $3)`,
			[userId, email, now],
		);
		const database = drizzle({ client: pool });
		const store = createPgEmailAccessGrantStore({ getDb: async () => database });
		const service = buildEmailAccessService({ environment: "test", now: () => now, store });
		const grant = await service.createGrant({
			actorId: "ops@example.test",
			email,
			idempotencyKey: `create-${suffix}`,
			kind: "invitation",
		});
		expect(grant).toMatchObject({ email, state: "pending", userId: null });
		await expect(service.markInvitationSent(grant.id)).resolves.toMatchObject({
			id: grant.id,
			lastInvitationSentAt: now,
		});

		await pool.query(
			`update "app_auth"."user" set "emailVerified" = true, "updatedAt" = $2 where "id" = $1`,
			[userId, now],
		);
		await expect(
			service.claimVerifiedUser({
				email,
				emailVerified: true,
				id: userId,
			}),
		).resolves.toEqual({ allowed: true, source: "email_grant" });
		await expect(
			service.evaluateAccountAccess({
				email,
				emailVerified: true,
				id: userId,
			}),
		).resolves.toEqual({ allowed: true, source: "email_grant" });

		await pool.query(
			`insert into "app_auth"."session"
				("id", "token", "userId", "expiresAt", "createdAt", "updatedAt")
			 values ($1, $2, $3, $4, $5, $5)`,
			[`session-${suffix}`, `token-${suffix}`, userId, new Date("2026-07-20T00:00:00.000Z"), now],
		);
		await service.revokeGrant({
			actorId: "ops@example.test",
			grantId: grant.id,
			idempotencyKey: `revoke-${suffix}`,
		});
		const state = await pool.query<{ banned: boolean; sessionCount: string }>(
			`select u."banned", count(s."id")::text as "sessionCount"
			 from "app_auth"."user" u
			 left join "app_auth"."session" s on s."userId" = u."id"
			 where u."id" = $1
			 group by u."id"`,
			[userId],
		);
		expect(state.rows[0]).toEqual({ banned: false, sessionCount: "0" });
		await expect(
			service.evaluateAccountAccess({
				email,
				emailVerified: true,
				id: userId,
			}),
		).resolves.toEqual({ allowed: false, reason: "email_access_required" });
	});

	it("lists grants by their effective state at the query time", async () => {
		const suffix = `${Date.now().toString(36)}-states`;
		const now = new Date("2026-07-19T12:00:00.000Z");
		const createdAt = new Date("2026-07-18T00:00:00.000Z");
		const expiredActiveUserId = `expired-active-user-${suffix}`;
		await pool.query(
			`insert into "app_auth"."user"
				("id", "name", "email", "emailVerified", "passwordChangeRequired", "createdAt", "updatedAt")
			 values ($1, $1, $2, true, false, $3, $3)`,
			[expiredActiveUserId, `expired-active-${suffix}@example.com`, createdAt],
		);
		const records = [
			{
				accessExpiresAt: null,
				claimExpiresAt: new Date("2026-07-19T11:00:00.000Z"),
				email: `expired-pending-${suffix}@example.com`,
				id: `expired-pending-${suffix}`,
				state: "pending",
				userId: null,
			},
			{
				accessExpiresAt: new Date("2026-07-19T11:00:00.000Z"),
				claimExpiresAt: new Date("2026-07-20T00:00:00.000Z"),
				email: `expired-active-${suffix}@example.com`,
				id: `expired-active-${suffix}`,
				state: "active",
				userId: expiredActiveUserId,
			},
			{
				accessExpiresAt: null,
				claimExpiresAt: new Date("2026-07-20T00:00:00.000Z"),
				email: `current-pending-${suffix}@example.com`,
				id: `current-pending-${suffix}`,
				state: "pending",
				userId: null,
			},
		] as const;
		for (const record of records) {
			await pool.query(
				`insert into "app_auth"."email_access_grant"
					("access_expires_at", "claim_expires_at", "claimed_at", "created_at", "created_by", "email",
					 "environment", "id", "kind", "state", "updated_at", "user_id")
				 values ($1, $2, case when $6::text = 'active' then $3::timestamptz else null end, $3,
					'ops@example.test', $4, 'test', $5, 'invitation', $6, $3, $7)`,
				[
					record.accessExpiresAt,
					record.claimExpiresAt,
					createdAt,
					record.email,
					record.id,
					record.state,
					record.userId,
				],
			);
		}

		const database = drizzle({ client: pool });
		const store = createPgEmailAccessGrantStore({ getDb: async () => database });
		await expect(
			store.list({ environment: "test", limit: 10, now, state: "pending" }),
		).resolves.toMatchObject({ items: [{ id: `current-pending-${suffix}`, state: "pending" }] });
		const expired = await store.list({ environment: "test", limit: 10, now, state: "expired" });
		expect(expired.items).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: `expired-pending-${suffix}`, state: "expired" }),
				expect.objectContaining({ id: `expired-active-${suffix}`, state: "expired" }),
			]),
		);
		expect(expired.items).not.toEqual(
			expect.arrayContaining([expect.objectContaining({ id: `current-pending-${suffix}` })]),
		);
	});
});
