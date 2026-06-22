// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const { createRuntimeDatabase, createRuntimeDbGetter } = vi.hoisted(() => ({
	createRuntimeDatabase: vi.fn(),
	createRuntimeDbGetter: vi.fn(() => () => createRuntimeDatabase()),
}));

vi.mock("../src/db/runtime", () => ({
	createRuntimeDatabase,
	createRuntimeDbGetter,
}));

import { createPgChatCommandStore } from "../src/modules/runtime-command/store";
import type { FinalizeRequestWrite } from "../src/modules/runtime-command/store-types";

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
			runId: "run_01HQ",
			structuredParts: [],
			text: "国家奖学金每学年评审一次。",
			turnSequence: 1,
		},
		contextSummary: "国家奖学金每学年评审一次。",
		conversationTitle: "中央民族大学本科学生国家奖学金评审办法",
		ownerUserId: "user_01HQ",
		outboxEvent: {
			attemptCount: 0,
			availableAt: "2026-06-04T01:02:06.000Z",
			eventId: "evt_final_01HQ",
			eventType: "request.completed",
			lastError: null,
			occurredAt: "2026-06-04T01:02:06.000Z",
			payload: {},
			processedAt: null,
			requestId: "req_01HQ",
		},
		requestExecution: {
			actorDepartments: [],
			actorPrincipalId: "user_01HQ",
			actorRoles: ["student"],
			actorUserId: "user_01HQ",
			answerPreview: "国家奖学金每学年评审一次。",
			applicabilityScope: "undergraduate",
			assistantMessageId: "msg_assistant_01HQ",
			completedAt: "2026-06-04T01:02:06.000Z",
			conversationId: "conv_01HQ",
			createdAt: "2026-06-04T01:02:03.000Z",
			diagnostics: null,
			durationMs: 3000,
			entitlementGroups: ["students"],
			entitlementSnapshotId: "entitlements_01HQ",
			errorCode: null,
			idempotencyKey: null,
			principalLabel: "Jane Doe",
			principalType: "student",
			questionPreview: "中央民族大学本科学生国家奖学金评审办法",
			requestedCapability: "knowledge",
			requestedScope: null,
			requestFingerprintSha256: null,
			requestId: "req_01HQ",
			resolvedScope: null,
			runId: "run_01HQ",
			safetyIdentifier: "safety_01HQ",
			selectedCapability: "knowledge",
			sourceDocIds: ["student_rules:national-scholarship"],
			startedAt: "2026-06-04T01:02:03.000Z",
			status: "completed",
			surface: "campus_web",
			traceId: "trace_01HQ",
			turnSequence: 1,
			updatedAt: "2026-06-04T01:02:06.000Z",
			userMessageId: "msg_user_01HQ",
			versionQuery: null,
			visibilityScope: "main",
		},
		requestObservabilityFact: {
			aclAnomalyCode: null,
			aclDecision: null,
			cachedInputTokens: null,
			candidateCount: null,
			citationCount: 1,
			citationExpected: true,
			citationMissing: false,
			claimSupportSummary: null,
			collection: null,
			completedAt: "2026-06-04T01:02:06.000Z",
			conversationId: "conv_01HQ",
			durationMs: 3000,
			emptyRecall: false,
			entitlementSnapshotId: "entitlements_01HQ",
			errorCode: null,
			estimatedCostMicrousd: null,
			failClosed: false,
			inputTokens: null,
			billableStepCount: null,
			modelUsageSummary: null,
			intentCapability: null,
			intentClassifierVersion: null,
			intentLaunchState: null,
			intentNextAction: null,
			intentPolicyReason: null,
			intentScopeClass: null,
			intentScopeReason: null,
			intentTaskKind: null,
			measuredAt: "2026-06-04T01:02:06.000Z",
			modelName: null,
			modelProvider: null,
			outputTokens: null,
			policyProjectionVersion: null,
			policyReason: null,
			principalType: "student",
			projectionLagMs: null,
			promptId: null,
			modelExecutionDetail: null,
			modelExecutionState: null,
			promptVersion: null,
			refusalClass: null,
			remoteContentSuspicionSummary: null,
			requestedCapability: "knowledge",
			requestedScopeSummary: null,
			requestId: "req_01HQ",
			resolvedScopeSummary: null,
			retrievalAdequacyReason: null,
			retrievalAdequacyVerdict: null,
			retrievalAttempted: true,
			retrievedSourceCount: 1,
			retrievedSources: [],
			safetyIdentifier: "safety_01HQ",
			scopeClass: null,
			selectedCapability: "knowledge",
			selectedTool: null,
			semanticOutcome: null,
			sourceTrustSummary: null,
			startedAt: "2026-06-04T01:02:03.000Z",
			status: "completed",
			supportingSources: [],
			surface: "campus_web",
			templateSha256: null,
			toolBusinessOutcome: null,
			toolFailCloseReason: null,
			toolHistoricalDowngradeReason: null,
			traceAvailable: true,
			traceId: "trace_01HQ",
			updatedAt: "2026-06-04T01:02:06.000Z",
			versionQueryMode: null,
			versionQuerySummary: null,
		},
		sessionSlots: [],
	};
}

describe("pg chat command store", () => {
	beforeEach(() => {
		createRuntimeDatabase.mockReset();
		createRuntimeDbGetter.mockClear();
		createRuntimeDbGetter.mockImplementation(() => () => createRuntimeDatabase());
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

		const store = createPgChatCommandStore({} as never);

		await store.findIdempotentRequest({
			actorUserId: "user_01HQ",
			idempotencyKey: "idem-01",
		});
		await store.findIdempotentRequest({
			actorUserId: "user_02HQ",
			idempotencyKey: "idem-02",
		});

		expect(createRuntimeDbGetter).toHaveBeenCalledTimes(1);
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

		const store = createPgChatCommandStore({} as never);

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
		const returning = vi.fn().mockResolvedValue([]);
		const updateWhere = vi.fn(() => ({ returning }));
		const set = vi.fn(() => ({ where: updateWhere }));
		const update = vi.fn(() => ({ set }));
		const insert = vi.fn();
		const transaction = vi.fn(async (callback: (tx: unknown) => Promise<void>) =>
			callback({
				insert,
				update,
			}),
		);

		createRuntimeDatabase.mockResolvedValue({
			transaction,
		});

		const store = createPgChatCommandStore({} as never);

		await expect(store.finalizeRequest(finalizedWrite())).rejects.toThrow(
			"Cannot finalize request req_01HQ because it is not in accepted status.",
		);
		expect(update).toHaveBeenCalledTimes(1);
		expect(returning).toHaveBeenCalledWith({ requestId: expect.anything() });
		expect(insert).not.toHaveBeenCalled();
	});

	it("keeps session slots and active branch state when a stale run finalizes after a newer turn", async () => {
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
				update,
			}),
		);
		const selectLimit = vi.fn().mockResolvedValue([
			{
				activeBranchId: "branch_active",
				activeMessageId: "msg_newer",
				activeRunId: "run_newer",
				activeTurnSequence: 2,
				contextSummary: "newer summary",
				createdAt: new Date("2026-06-04T01:02:00.000Z"),
				id: "conv_01HQ",
				ownerUserId: "user_01HQ",
				title: "中央民族大学本科学生国家奖学金评审办法",
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

		const store = createPgChatCommandStore({} as never);
		const conversation = await store.finalizeRequest(finalizedWrite());

		expect(conversation).toMatchObject({
			activeMessageId: "msg_newer",
			activeRunId: "run_newer",
			activeTurnSequence: 2,
			contextSummary: "newer summary",
			sessionSlots: [
				expect.objectContaining({
					name: "policy_topic",
					value: "newer topic",
				}),
			],
		});
		expect(update).toHaveBeenCalledTimes(2);
		expect(insert).toHaveBeenCalledTimes(3);
		expect(deleteFn).not.toHaveBeenCalled();
		expect(insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				isActiveBranchHead: false,
				id: "msg_assistant_01HQ",
				runId: "run_01HQ",
				turnSequence: 1,
			}),
		);
	});
});
