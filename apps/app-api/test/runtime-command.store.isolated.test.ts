// @vitest-environment node

import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createRuntimeDatabase, createRuntimeDbGetter } = vi.hoisted(() => ({
	createRuntimeDatabase: vi.fn(),
	createRuntimeDbGetter: vi.fn(() => () => createRuntimeDatabase()),
}));

vi.mock("../src/db/runtime", () => ({
	createRuntimeDatabase,
	createRuntimeDbGetter,
}));

import { conversations } from "../src/db/schema";
import {
	ChatAcceptanceConversationConflict,
	ChatAcceptanceIdempotencyConflict,
	createPgChatCommandPersistence,
} from "../src/modules/runtime-command/store";
import type {
	AcceptRequestWrite,
	FinalizeRequestWrite,
} from "../src/modules/runtime-command/store-types";
import { ChatFinalizationConflict } from "../src/modules/runtime-command/store-types";

function createPgChatCommandStore(...args: Parameters<typeof createPgChatCommandPersistence>) {
	const persistence = createPgChatCommandPersistence(...args);
	return {
		...persistence.commands,
		...persistence.observability,
	};
}

function finalizedWrite(): FinalizeRequestWrite {
	return {
		assistantMessage: {
			branchId: "branch_active",
			conversationId: "conv_01HQ",
			createdAt: "2026-06-04T01:02:06.000Z",
			id: "msg_assistant_01HQ",
			isActiveBranchHead: true,
			kind: "answer",
			parentMessageId: "msg_user_01HQ",
			requestId: "req_01HQ",
			retryable: null,
			role: "assistant",
			structuredParts: [],
			text: "国家奖学金每学年评审一次。",
			turnSequence: 1,
		},
		conversationTitle: "示例大学本科学生国家奖学金评审办法",
		ownerUserId: "user_01HQ",
		turnDispatch: {
			completedAt: "2026-06-04T01:02:06.000Z",
			errorCode: null,
			requestId: "req_01HQ",
			safetyIdentifier: "safety_01HQ",
			status: "completed",
			turnSequence: 1,
			updatedAt: "2026-06-04T01:02:06.000Z",
		},
		requestObservabilityFact: {
			aclAnomalyCode: null,
			aclDecision: null,
			completedAt: "2026-06-04T01:02:06.000Z",
			conversationId: "conv_01HQ",
			durationMs: 3000,
			entitlementSnapshotId: "entitlements_01HQ",
			errorCode: null,
			failClosed: false,
			measuredAt: "2026-06-04T01:02:06.000Z",
			modelName: null,
			modelProvider: null,
			policyReason: null,
			principalType: "student",
			requestId: "req_01HQ",
			safetyIdentifier: "safety_01HQ",
			startedAt: "2026-06-04T01:02:03.000Z",
			status: "completed",
			surface: "campus_web",
			stageTiming: {
				"workflow.execute_step_ms": 320,
			},
			updatedAt: "2026-06-04T01:02:06.000Z",
		},
		sessionSlots: [],
	};
}

function conversationReadSelect(activeRequestId: string | null = "req_01HQ") {
	const limit = vi.fn().mockResolvedValue([
		{
			activeBranchId: "branch_active",
			activeMessageId: "msg_assistant_01HQ",
			activeRequestId,
			activeTurnSequence: 1,
			createdAt: new Date("2026-06-04T01:02:00.000Z"),
			id: "conv_01HQ",
			ownerUserId: "user_01HQ",
			title: "示例大学本科学生国家奖学金评审办法",
			updatedAt: new Date("2026-06-04T01:02:06.000Z"),
		},
	]);
	const orderBy = vi.fn().mockResolvedValue([]);
	const where = vi.fn(() => ({ limit, orderBy }));
	const from = vi.fn(() => ({ where }));
	return vi.fn(() => ({ from }));
}

function prepareFinalizationDatabase(activeRequestId: string | null) {
	const forUpdate = vi
		.fn()
		.mockResolvedValue([{ finalizationFingerprint: null, status: "accepted" }]);
	const transactionSelect = vi.fn(() => ({
		from: () => ({ where: () => ({ limit: () => ({ for: forUpdate }) }) }),
	}));
	const requestReturning = vi.fn().mockResolvedValue([{ requestId: "req_01HQ" }]);
	const conversationReturning = vi.fn().mockResolvedValue([{ id: "conv_01HQ" }]);
	const updateWhere = vi
		.fn()
		.mockReturnValueOnce({ returning: requestReturning })
		.mockReturnValueOnce({ returning: conversationReturning })
		.mockReturnValueOnce(undefined);
	const updateSet = vi.fn((_values: Record<string, unknown>) => ({ where: updateWhere }));
	const update = vi.fn(() => ({ set: updateSet }));
	const onConflictDoUpdate = vi.fn();
	const insertValues = vi.fn(() => ({ onConflictDoUpdate }));
	const insert = vi.fn(() => ({ values: insertValues }));
	const deleteFn = vi.fn();
	const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
		callback({ delete: deleteFn, insert, select: transactionSelect, update }),
	);
	const selectLimit = vi.fn().mockResolvedValue([
		{
			activeBranchId: "branch_active",
			activeMessageId: "msg_assistant_01HQ",
			activeRequestId,
			activeTurnSequence: 1,
			createdAt: new Date("2026-06-04T01:02:00.000Z"),
			id: "conv_01HQ",
			ownerUserId: "user_01HQ",
			title: "示例大学本科学生国家奖学金评审办法",
			updatedAt: new Date("2026-06-04T01:02:06.000Z"),
		},
	]);
	const selectOrderBy = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]);
	const selectWhere = vi.fn(() => ({ orderBy: selectOrderBy, limit: selectLimit }));
	const selectFrom = vi.fn(() => ({ where: selectWhere }));
	const select = vi.fn(() => ({ from: selectFrom }));

	createRuntimeDatabase.mockResolvedValue({ select, transaction });

	return { updateSet };
}

function finalizedWriteForStatus(
	status: "approval_required" | "cancelled" | "completed" | "error" | "rejected",
) {
	const write = finalizedWrite();
	write.turnDispatch.status = status;
	write.requestObservabilityFact.status = status;
	if (status !== "completed") {
		write.assistantMessage.kind = "error";
		write.assistantMessage.retryable = false;
		write.turnDispatch.errorCode = "execution_failed";
		write.requestObservabilityFact.errorCode = "execution_failed";
	}
	return write;
}

describe("pg chat command store", () => {
	it("looks up closeout by exact request identity without time or status filters", async () => {
		const where = vi.fn().mockResolvedValue([]);
		createRuntimeDatabase.mockReturnValue({
			select: () => ({ from: () => ({ where }) }),
		});
		const store = createPgChatCommandStore({ getDb: createRuntimeDatabase });
		expect(await store.getDurableRequestForCloseout("req_unknown")).toBeNull();
		const query = new PgDialect().sqlToQuery(where.mock.calls[0]?.[0] as SQL);
		expect(query.sql).toBe('"chat"."turn_dispatches"."request_id" = $1');
		expect(query.params).toEqual(["req_unknown"]);
	});

	beforeEach(() => {
		createRuntimeDatabase.mockReset();
		createRuntimeDbGetter.mockClear();
		createRuntimeDbGetter.mockImplementation(() => () => createRuntimeDatabase());
	});

	it("rejects a stale conversation baseline before freezing or writing the accepted turn", async () => {
		const forUpdate = vi.fn().mockResolvedValue([
			{
				activeBranchId: "branch_active",
				activeMessageId: "msg_newer",
				activeRequestId: "req_newer",
				activeTurnSequence: 2,
				id: "conv_01HQ",
				updatedAt: new Date("2026-06-04T01:02:04.000Z"),
			},
		]);
		const limit = vi.fn(() => ({ for: forUpdate }));
		const where = vi.fn(() => ({ limit }));
		const from = vi.fn(() => ({ where }));
		const select = vi.fn(() => ({ from }));
		const insert = vi.fn();
		const update = vi.fn();
		const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
			callback({ insert, select, update }),
		);
		createRuntimeDatabase.mockResolvedValue({ transaction });
		const freezeDurableRun = vi.fn();
		const store = createPgChatCommandStore({ getDb: createRuntimeDatabase });

		await expect(
			store.acceptRequest({
				requestKind: "internal_eval",
				conversationBaseline: {
					activeBranchId: "branch_active",
					activeMessageId: null,
					activeRequestId: null,
					activeTurnSequence: 1,
					updatedAt: "2026-06-04T01:02:03.000Z",
				},
				freezeDurableRun,
				ownerUserId: "user_01HQ",
				turnDispatch: { idempotencyKey: null },
				userMessage: { conversationId: "conv_01HQ" },
			} as unknown as AcceptRequestWrite),
		).rejects.toBeInstanceOf(ChatAcceptanceConversationConflict);
		expect(freezeDurableRun).not.toHaveBeenCalled();
		expect(insert).not.toHaveBeenCalled();
		expect(update).not.toHaveBeenCalled();
	});

	it("prefers the committed idempotency winner when it also advanced the conversation baseline", async () => {
		const seedOnConflictDoNothing = vi.fn().mockResolvedValue(undefined);
		const seedValues = vi.fn(() => ({ onConflictDoNothing: seedOnConflictDoNothing }));
		const conversationForUpdate = vi.fn().mockResolvedValue([
			{
				activeBranchId: "branch_active",
				activeMessageId: "msg_winner",
				activeRequestId: "req_winner",
				activeTurnSequence: 2,
				id: "conv_01HQ",
				updatedAt: new Date("2026-06-04T01:02:04.000Z"),
			},
		]);
		const conversationLimit = vi.fn(() => ({ for: conversationForUpdate }));
		const conversationWhere = vi.fn(() => ({ limit: conversationLimit }));
		const conversationFrom = vi.fn(() => ({ where: conversationWhere }));
		const winnerLimit = vi.fn().mockResolvedValue([{ requestId: "req_winner" }]);
		const winnerWhere = vi.fn(() => ({ limit: winnerLimit }));
		const winnerFrom = vi.fn(() => ({ where: winnerWhere }));
		const select = vi
			.fn()
			.mockReturnValueOnce({ from: conversationFrom })
			.mockReturnValueOnce({ from: winnerFrom });
		const insert = vi.fn(() => ({ values: seedValues }));
		const update = vi.fn();
		const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
			callback({ insert, select, update }),
		);
		createRuntimeDatabase.mockResolvedValue({ transaction });
		const freezeDurableRun = vi.fn();
		const store = createPgChatCommandStore({ getDb: createRuntimeDatabase });

		await expect(
			store.acceptRequest({
				requestKind: "internal_eval",
				conversationSeed: {
					createdAt: "2026-06-04T01:02:03.000Z",
					id: "conv_01HQ",
					ownerUserId: "user_01HQ",
					title: "国家奖学金",
					updatedAt: "2026-06-04T01:02:03.000Z",
				},
				conversationBaseline: {
					activeBranchId: "branch_active",
					activeMessageId: null,
					activeRequestId: null,
					activeTurnSequence: 1,
					updatedAt: "2026-06-04T01:02:03.000Z",
				},
				freezeDurableRun,
				ownerUserId: "user_01HQ",
				turnDispatch: {
					actorUserId: "user_01HQ",
					idempotencyKey: "idem-race",
				},
				userMessage: { conversationId: "conv_01HQ" },
			} as unknown as AcceptRequestWrite),
		).rejects.toBeInstanceOf(ChatAcceptanceIdempotencyConflict);
		expect(seedOnConflictDoNothing).toHaveBeenCalledWith({ target: conversations.id });
		expect(winnerLimit).toHaveBeenCalledWith(1);
		expect(freezeDurableRun).not.toHaveBeenCalled();
		expect(insert).toHaveBeenCalledTimes(1);
		expect(update).not.toHaveBeenCalled();
	});

	it("fails closed when a concurrent conversation seed belongs to another owner", async () => {
		const seedOnConflictDoNothing = vi.fn().mockResolvedValue(undefined);
		const seedValues = vi.fn(() => ({ onConflictDoNothing: seedOnConflictDoNothing }));
		const conversationForUpdate = vi.fn().mockResolvedValue([]);
		const conversationLimit = vi.fn(() => ({ for: conversationForUpdate }));
		const conversationWhere = vi.fn(() => ({ limit: conversationLimit }));
		const conversationFrom = vi.fn(() => ({ where: conversationWhere }));
		const select = vi.fn(() => ({ from: conversationFrom }));
		const insert = vi.fn(() => ({ values: seedValues }));
		const update = vi.fn();
		const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
			callback({ insert, select, update }),
		);
		createRuntimeDatabase.mockResolvedValue({ transaction });
		const freezeDurableRun = vi.fn();
		const store = createPgChatCommandStore({ getDb: createRuntimeDatabase });

		await expect(
			store.acceptRequest({
				requestKind: "internal_eval",
				conversationSeed: {
					createdAt: "2026-06-04T01:02:03.000Z",
					id: "conv_01HQ",
					ownerUserId: "user_01HQ",
					title: "国家奖学金",
					updatedAt: "2026-06-04T01:02:03.000Z",
				},
				conversationBaseline: {
					activeBranchId: "branch_active",
					activeMessageId: null,
					activeRequestId: null,
					activeTurnSequence: 0,
					updatedAt: "2026-06-04T01:02:03.000Z",
				},
				freezeDurableRun,
				ownerUserId: "user_01HQ",
				turnDispatch: { idempotencyKey: "idem-race" },
				userMessage: { conversationId: "conv_01HQ" },
			} as unknown as AcceptRequestWrite),
		).rejects.toBeInstanceOf(ChatAcceptanceConversationConflict);
		expect(seedOnConflictDoNothing).toHaveBeenCalledWith({ target: conversations.id });
		expect(freezeDurableRun).not.toHaveBeenCalled();
		expect(insert).toHaveBeenCalledTimes(1);
		expect(update).not.toHaveBeenCalled();
	});

	it("uses a non-persistent runtime getter so sequential idempotency lookups do not share a db handle by default", async () => {
		const limit = vi.fn().mockResolvedValue([]);
		const where = vi.fn(() => ({
			limit,
		}));
		const from = vi.fn(() => ({
			where,
		}));
		const select = vi.fn(() => ({
			from,
		}));

		createRuntimeDatabase.mockResolvedValue({
			select,
		});

		const store = createPgChatCommandStore({ getDb: createRuntimeDatabase });

		await store.findIdempotentRequest({
			actorUserId: "user_01HQ",
			idempotencyKey: "idem-01",
		});
		await store.findIdempotentRequest({
			actorUserId: "user_02HQ",
			idempotencyKey: "idem-02",
		});

		expect(createRuntimeDatabase).toHaveBeenCalledTimes(2);
	});

	it("derives abuse throttle state from durable request execution truth", async () => {
		const where = vi.fn().mockResolvedValue([
			{
				errorCode: null,
				startedAt: new Date("2026-03-28T08:05:50.000Z"),
			},
			{
				errorCode: null,
				startedAt: new Date("2026-03-28T08:05:40.000Z"),
			},
			{
				errorCode: null,
				startedAt: new Date("2026-03-28T08:05:30.000Z"),
			},
			{
				errorCode: null,
				startedAt: new Date("2026-03-28T08:05:20.000Z"),
			},
			{
				errorCode: null,
				startedAt: new Date("2026-03-28T08:05:05.000Z"),
			},
			{
				errorCode: null,
				startedAt: new Date("2026-03-28T08:05:00.000Z"),
			},
			{
				errorCode: null,
				startedAt: new Date("2026-03-28T08:05:01.000Z"),
			},
			{
				errorCode: null,
				startedAt: new Date("2026-03-28T08:05:02.000Z"),
			},
			{
				errorCode: null,
				startedAt: new Date("2026-03-28T08:05:03.000Z"),
			},
			{
				errorCode: "rate_limit_exceeded",
				startedAt: new Date("2026-03-28T08:03:00.000Z"),
			},
		]);
		const from = vi.fn(() => ({
			where,
		}));
		const select = vi.fn(() => ({
			from,
		}));

		createRuntimeDatabase.mockResolvedValue({
			select,
		});

		const store = createPgChatCommandStore({ getDb: createRuntimeDatabase });

		const state = await store.getAbuseControlState({
			now: "2026-03-28T08:06:00.000Z",
			safetyIdentifier: "safe_01HQ",
			surface: "campus_web",
		});

		expect(state).toEqual({
			activeThrottleUntil: "2026-03-28T08:08:00.000Z",
			requestCountLastMinute: 9,
			requestCountLastTenMinutes: 10,
			shouldThrottle: true,
			throttleReason: "active_throttle_window",
		});
	});

	it("fails closed before inserting finalization rows when request is no longer accepted", async () => {
		const forUpdate = vi
			.fn()
			.mockResolvedValue([{ finalizationFingerprint: null, status: "completed" }]);
		const selectLimit = vi.fn(() => ({ for: forUpdate }));
		const selectWhere = vi.fn(() => ({ limit: selectLimit }));
		const selectFrom = vi.fn(() => ({ where: selectWhere }));
		const select = vi.fn(() => ({ from: selectFrom }));
		const returning = vi.fn().mockResolvedValue([]);
		const updateWhere = vi.fn(() => ({ returning }));
		const set = vi.fn(() => ({ where: updateWhere }));
		const update = vi.fn(() => ({ set }));
		const insert = vi.fn();
		const transaction = vi.fn(async (callback: (tx: unknown) => Promise<void>) =>
			callback({
				insert,
				select,
				update,
			}),
		);

		createRuntimeDatabase.mockResolvedValue({
			transaction,
		});

		const store = createPgChatCommandStore({ getDb: createRuntimeDatabase });

		await expect(store.finalizeRequest(finalizedWrite())).rejects.toThrow(
			"Cannot finalize request req_01HQ because it is not in accepted status.",
		);
		expect(update).toHaveBeenCalledTimes(1);
		expect(returning).toHaveBeenCalledWith({ requestId: expect.anything() });
		expect(insert).not.toHaveBeenCalled();
	});

	it.each(["completed", "error", "cancelled", "approval_required", "rejected"] as const)(
		"clears activeRequestId when the finalization CAS still owns a %s request",
		async (status) => {
			const { updateSet } = prepareFinalizationDatabase(null);
			const store = createPgChatCommandStore({ getDb: createRuntimeDatabase });

			const result = await store.finalizeRequest(finalizedWriteForStatus(status));

			expect(result).toMatchObject({
				outcome: "applied",
				conversation: {
					activeRequestId: null,
					activeTurnSequence: 1,
				},
			});
			expect(updateSet.mock.calls[1]?.[0]).toMatchObject({
				activeRequestId: null,
				activeTurnSequence: 1,
			});
		},
	);

	it("returns an exact finalization tuple replay without issuing writes", async () => {
		const completedAt = new Date("2026-06-04T01:02:06.000Z");
		const forUpdate = vi.fn().mockResolvedValue([
			{
				completedAt,
				finalizationFingerprint: "finalization-01",
				status: "completed",
			},
		]);
		const transactionSelect = vi.fn(() => ({
			from: () => ({ where: () => ({ limit: () => ({ for: forUpdate }) }) }),
		}));
		const update = vi.fn();
		const insert = vi.fn();
		const deleteFn = vi.fn();
		const transaction = vi.fn(async (callback: (tx: unknown) => Promise<void>) =>
			callback({ delete: deleteFn, insert, select: transactionSelect, update }),
		);
		createRuntimeDatabase.mockResolvedValue({
			select: conversationReadSelect(),
			transaction,
		});
		const write = finalizedWrite();
		write.finalizationFingerprint = "finalization-01";
		const store = createPgChatCommandStore({ getDb: createRuntimeDatabase });

		await expect(store.finalizeRequest(write)).resolves.toMatchObject({
			outcome: "replayed",
		});
		expect(update).not.toHaveBeenCalled();
		expect(insert).not.toHaveBeenCalled();
		expect(deleteFn).not.toHaveBeenCalled();
	});

	it.each([
		{
			completedAt: new Date("2026-06-04T01:02:07.000Z"),
			finalizationFingerprint: "finalization-01",
			label: "a different completion time",
		},
		{
			completedAt: new Date("2026-06-04T01:02:06.000Z"),
			finalizationFingerprint: null,
			label: "a partial stored identity",
		},
	])("rejects $label for a fingerprinted finalization", async (existing) => {
		const forUpdate = vi.fn().mockResolvedValue([
			{
				completedAt: existing.completedAt,
				finalizationFingerprint: existing.finalizationFingerprint,
				status: "completed",
			},
		]);
		const select = vi.fn(() => ({
			from: () => ({ where: () => ({ limit: () => ({ for: forUpdate }) }) }),
		}));
		const update = vi.fn();
		const transaction = vi.fn(async (callback: (tx: unknown) => Promise<void>) =>
			callback({ select, update }),
		);
		createRuntimeDatabase.mockResolvedValue({ transaction });
		const write = finalizedWrite();
		write.finalizationFingerprint = "finalization-01";
		const store = createPgChatCommandStore({ getDb: createRuntimeDatabase });

		await expect(store.finalizeRequest(write)).rejects.toBeInstanceOf(ChatFinalizationConflict);
		expect(update).not.toHaveBeenCalled();
	});

	it("backfills terminal TTFT once with derived overhead and a monotonic update time", async () => {
		const returning = vi
			.fn()
			.mockResolvedValueOnce([{ requestId: "req_01HQ" }])
			.mockResolvedValueOnce([]);
		const where = vi.fn((_condition: SQL) => ({ returning }));
		const set = vi.fn((_values: Record<string, unknown>) => ({ where }));
		const update = vi.fn(() => ({ set }));
		createRuntimeDatabase.mockResolvedValue({ update });
		const store = createPgChatCommandStore({ getDb: createRuntimeDatabase });

		await expect(
			store.recordStreamAppApiTtft({
				durationMs: 420,
				observedAt: "2026-06-04T01:02:04.000Z",
				requestId: "req_01HQ",
			}),
		).resolves.toBe(true);
		await expect(
			store.recordStreamAppApiTtft({
				durationMs: 900,
				observedAt: "2026-06-04T01:02:05.000Z",
				requestId: "req_01HQ",
			}),
		).resolves.toBe(false);

		const dialect = new PgDialect();
		const values = set.mock.calls[0]?.[0] as {
			stageTimingJson: SQL;
			updatedAt: SQL;
		};
		const timingQuery = dialect.sqlToQuery(values.stageTimingJson);
		const updatedAtQuery = dialect.sqlToQuery(values.updatedAt);
		const conditionQuery = dialect.sqlToQuery(where.mock.calls[0]?.[0] as SQL);

		expect(timingQuery.sql).toContain("jsonb_typeof");
		expect(timingQuery.sql).toContain("stream.app_api_ttft_ms");
		expect(timingQuery.sql).toContain("stream.orchestration_overhead_ms");
		expect(timingQuery.params).toContain(420);
		expect(updatedAtQuery.sql).toContain("greatest");
		expect(updatedAtQuery.params).toContainEqual(new Date("2026-06-04T01:02:04.000Z"));
		expect(conditionQuery.sql).toContain("request_id");
		expect(conditionQuery.sql).toContain("stream.app_api_ttft_ms");
		expect(conditionQuery.sql).not.toContain("status");
		expect(returning).toHaveBeenCalledTimes(2);
	});

	it("keeps session slots and active branch state when a stale run finalizes after a newer turn", async () => {
		const forUpdate = vi
			.fn()
			.mockResolvedValue([{ finalizationFingerprint: null, status: "accepted" }]);
		const transactionSelectLimit = vi.fn(() => ({ for: forUpdate }));
		const transactionSelectWhere = vi.fn(() => ({ limit: transactionSelectLimit }));
		const transactionSelectFrom = vi.fn(() => ({ where: transactionSelectWhere }));
		const transactionSelect = vi.fn(() => ({ from: transactionSelectFrom }));
		const requestReturning = vi.fn().mockResolvedValueOnce([{ requestId: "req_01HQ" }]);
		const conversationReturning = vi.fn().mockResolvedValueOnce([]);
		const onConflictDoUpdate = vi.fn();
		const updateWhere = vi
			.fn()
			.mockReturnValueOnce({ returning: requestReturning })
			.mockReturnValueOnce({ returning: conversationReturning })
			.mockReturnValueOnce(undefined);
		const updateSet = vi.fn(() => ({ where: updateWhere }));
		const update = vi.fn(() => ({ set: updateSet }));
		const insertValues = vi.fn(() => ({ onConflictDoUpdate }));
		const insert = vi.fn(() => ({ values: insertValues }));
		const deleteFn = vi.fn();
		const transaction = vi.fn(async (callback: (tx: unknown) => Promise<void>) =>
			callback({
				delete: deleteFn,
				insert,
				select: transactionSelect,
				update,
			}),
		);
		const selectLimit = vi.fn().mockResolvedValue([
			{
				activeBranchId: "branch_active",
				activeMessageId: "msg_newer",
				activeRequestId: "req_newer",
				activeTurnSequence: 2,
				createdAt: new Date("2026-06-04T01:02:00.000Z"),
				id: "conv_01HQ",
				ownerUserId: "user_01HQ",
				title: "示例大学本科学生国家奖学金评审办法",
				updatedAt: new Date("2026-06-04T01:02:10.000Z"),
			},
		]);
		const selectOrderBy = vi
			.fn()
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([
				{
					confirmed: true,
					conversationId: "conv_01HQ",
					name: "policy_topic",
					updatedAt: new Date("2026-06-04T01:02:10.000Z"),
					value: "newer topic",
				},
			]);
		const selectWhere = vi.fn(() => ({ orderBy: selectOrderBy, limit: selectLimit }));
		const selectFrom = vi.fn(() => ({ where: selectWhere }));
		const select = vi.fn(() => ({ from: selectFrom }));

		createRuntimeDatabase.mockResolvedValue({
			select,
			transaction,
		});

		const store = createPgChatCommandStore({ getDb: createRuntimeDatabase });
		const result = await store.finalizeRequest(finalizedWrite());

		expect(result).toMatchObject({
			outcome: "applied",
			conversation: {
				activeMessageId: "msg_newer",
				activeRequestId: "req_newer",
				activeTurnSequence: 2,
				sessionSlots: [
					expect.objectContaining({
						name: "policy_topic",
						value: "newer topic",
					}),
				],
			},
		});
		expect(update).toHaveBeenCalledTimes(2);
		expect(insert).toHaveBeenCalledTimes(2);
		expect(deleteFn).not.toHaveBeenCalled();
		expect(insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				isActiveBranchHead: false,
				id: "msg_assistant_01HQ",
				requestId: "req_01HQ",
				turnSequence: 1,
			}),
		);
		expect(insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				stageTimingJson: {
					"workflow.execute_step_ms": 320,
				},
			}),
		);
		const conflictUpdate = onConflictDoUpdate.mock.calls[0]?.[0] as {
			set: { stageTimingJson: SQL; updatedAt: SQL };
		};
		const dialect = new PgDialect();
		const conflictTimingQuery = dialect.sqlToQuery(conflictUpdate.set.stageTimingJson);
		const conflictUpdatedAtQuery = dialect.sqlToQuery(conflictUpdate.set.updatedAt);
		expect(conflictTimingQuery.sql).toContain("excluded.stage_timing_json");
		expect(conflictTimingQuery.sql).toContain("workflow.first_delta_ms");
		expect(conflictTimingQuery.sql).toContain("stream.app_api_ttft_ms");
		expect(conflictTimingQuery.sql).toContain("stream.orchestration_overhead_ms");
		expect(conflictUpdatedAtQuery.sql).toContain("greatest");
		expect(conflictUpdatedAtQuery.sql).toContain("excluded.updated_at");
	});
});
