// @vitest-environment node

import { drizzle } from "drizzle-orm/node-postgres";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import type { Env } from "../src/config";
import { appApiSchema } from "../src/db/schema";
import { createPgRuntimeRunStore, type RuntimeRunStore } from "../src/modules/runtime-run";

const postgres = inject("appApiPostgres");

describe("runtime run cancellation PostgreSQL integration", () => {
	let managementClient: Client;
	let runtimePool: Pool;
	let store: RuntimeRunStore;

	beforeAll(async () => {
		managementClient = new Client({
			connectionString: postgres.managementConnectionString,
			ssl: false,
		});
		await managementClient.connect();
		runtimePool = new Pool({
			connectionString: postgres.runtimeConnectionString,
			max: 4,
			ssl: false,
		});
		const database = drizzle(runtimePool, { schema: appApiSchema });
		store = createPgRuntimeRunStore({} as Env, { getDb: async () => database });
	});

	afterAll(async () => {
		await managementClient.end();
		await runtimePool.end();
	});

	async function insertPendingCancellation(suffix: string) {
		const now = new Date("2026-08-23T00:00:00.000Z");
		const conversationId = `cancel-conversation-${suffix}`;
		const messageId = `cancel-message-${suffix}`;
		const requestId = `cancel-request-${suffix}`;
		const runId = `cancel-run-${suffix}`;

		await managementClient.query(
			`insert into "chat"."conversations"
				("id", "owner_user_id", "title", "created_at", "updated_at")
			 values ($1, $2, 'Cancellation test', $3, $3)`,
			[conversationId, `cancel-owner-${suffix}`, now],
		);
		await managementClient.query(
			`insert into "chat"."messages"
				("id", "conversation_id", "role", "text", "created_at", "branch_id", "turn_sequence")
			 values ($1, $2, 'user', 'Cancellation test', $3, 'branch_active', 1)`,
			[messageId, conversationId, now],
		);
		await managementClient.query(
			`insert into "chat"."turn_dispatches"
				("request_id", "conversation_id", "user_message_id", "assistant_message_id",
				 "turn_sequence", "surface", "owner_user_id", "actor_user_id",
				 "principal_snapshot_json", "trace_id", "run_id", "admission_status",
				 "workflow_id", "execution_input_json", "execution_input_sha256",
				 "cancel_outbox_status", "cancel_reason", "cancel_requested_at", "status",
				 "created_at", "updated_at")
			 values ($1, $2, $3, $4, 1, 'campus_web', $5, $5, '{}'::jsonb, $6, $7,
				 'admitted', $8, '{}', 'execution-hash', 'pending_delivery',
				 'user_requested', $9, 'accepted', $9, $9)`,
			[
				requestId,
				conversationId,
				messageId,
				`assistant-message-${suffix}`,
				`cancel-owner-${suffix}`,
				`cancel-trace-${suffix}`,
				runId,
				`cancel-workflow-${suffix}`,
				now,
			],
		);

		return { conversationId, now, requestId, runId };
	}

	async function deleteFixture(conversationId: string): Promise<void> {
		await managementClient.query(`delete from "chat"."conversations" where "id" = $1`, [
			conversationId,
		]);
	}

	it("allows only one concurrent claim and rejects stale completion", async () => {
		const fixture = await insertPendingCancellation(`concurrent-${Date.now().toString(36)}`);
		try {
			const [first, second] = await Promise.all([
				store.claimPendingCancellations({
					leaseExpiresAt: new Date("2026-08-23T00:05:00.000Z"),
					leaseToken: "cancel-lease-first",
					limit: 1,
					now: fixture.now,
				}),
				store.claimPendingCancellations({
					leaseExpiresAt: new Date("2026-08-23T00:05:00.000Z"),
					leaseToken: "cancel-lease-second",
					limit: 1,
					now: fixture.now,
				}),
			]);
			const claims = [...first, ...second];
			expect(claims).toHaveLength(1);
			const claim = claims[0];
			if (!claim) {
				throw new Error("Expected one cancellation claim.");
			}

			const recovered = await store.claimPendingCancellations({
				leaseExpiresAt: new Date("2026-08-23T00:11:00.000Z"),
				leaseToken: "cancel-lease-recovered",
				limit: 1,
				now: new Date("2026-08-23T00:06:00.000Z"),
			});
			expect(recovered).toHaveLength(1);
			expect(recovered[0]?.leaseToken).toBe("cancel-lease-recovered");

			await expect(
				store.markCancellationDelivered({
					deliveredAt: "2026-08-23T00:06:01.000Z",
					leaseToken: claim.leaseToken,
					runId: fixture.runId,
				}),
			).resolves.toBe(false);
			await expect(
				store.recordCancellationFailure({
					errorCode: "test_cleanup",
					failedAt: "2026-08-23T00:06:02.000Z",
					leaseToken: "cancel-lease-recovered",
					runId: fixture.runId,
				}),
			).resolves.toBe(true);
		} finally {
			await deleteFixture(fixture.conversationId);
		}
	});

	it("allows the current lease owner to finish after expiry until another claim fences it", async () => {
		const fixture = await insertPendingCancellation(`expired-${Date.now().toString(36)}`);
		try {
			const claims = await store.claimPendingCancellations({
				leaseExpiresAt: new Date("2026-08-23T00:05:00.000Z"),
				leaseToken: "cancel-lease-expired-owner",
				limit: 1,
				now: fixture.now,
			});
			const claim = claims[0];
			if (!claim) {
				throw new Error("Expected one cancellation claim.");
			}

			await expect(
				store.markCancellationDelivered({
					deliveredAt: "2026-08-23T00:06:00.000Z",
					leaseToken: claim.leaseToken,
					runId: fixture.runId,
				}),
			).resolves.toBe(true);
		} finally {
			await deleteFixture(fixture.conversationId);
		}
	});

	it("shares the claim fence between HTTP and scheduled paths", async () => {
		const fixture = await insertPendingCancellation(`shared-${Date.now().toString(36)}`);
		try {
			const [httpClaim, scheduledClaims] = await Promise.all([
				store.claimCancellation({
					leaseExpiresAt: new Date("2026-08-23T00:05:00.000Z"),
					leaseToken: "cancel-lease-http",
					now: fixture.now,
					runId: fixture.runId,
				}),
				store.claimPendingCancellations({
					leaseExpiresAt: new Date("2026-08-23T00:05:00.000Z"),
					leaseToken: "cancel-lease-scheduled",
					limit: 1,
					now: fixture.now,
				}),
			]);

			expect([...(httpClaim ? [httpClaim] : []), ...scheduledClaims]).toHaveLength(1);
		} finally {
			await deleteFixture(fixture.conversationId);
		}
	});
});
