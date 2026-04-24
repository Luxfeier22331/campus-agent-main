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

import { createPgOperatorQueryStore } from "../src/modules/operator-query/store";
import { summarizeSafetyAnomaly } from "../src/modules/operator-query/store/safety";

describe("pg operator query store", () => {
	beforeEach(() => {
		createRuntimeDatabase.mockReset();
		createRuntimeDbGetter.mockClear();
		createRuntimeDbGetter.mockImplementation(() => () => createRuntimeDatabase());
	});

	it("projects retrieval plan summaries from request diagnostics into observability detail", async () => {
		const responses = [
			[
				{
					requestId: "req_01HQ",
					traceId: "trace_01HQ",
					conversationId: "conv_01HQ",
					surface: "public_chat_web",
					status: "completed",
					requestedCapability: "knowledge",
					requestedScopeJson: {
						corpus: "curriculum",
						collection: "curriculum_plan",
					},
					resolvedScopeJson: {
						corpus: "curriculum",
						collection: "curriculum_plan",
					},
					selectedTarget: "rag-agent",
					startedAt: new Date("2026-03-28T08:00:00.000Z"),
					completedAt: new Date("2026-03-28T08:00:01.000Z"),
					projectedAt: new Date("2026-03-28T08:00:02.000Z"),
					durationMs: 842,
					diagnosticsJson: {
						retrievalPlanSummary: {
							planId: "curriculum:curriculum_plan:current",
							queryMode: "current",
							replanCount: 0,
							terminalState: "completed",
							stepActivities: [
								{
									stepId: "indexed-lookup",
									stepType: "indexed_lookup",
									corpus: "curriculum",
									collection: "curriculum_plan",
									status: "succeeded",
									topK: 8,
									latencyMs: 18,
									candidateCount: 4,
									referenceCount: 4,
									failureKind: null,
								},
							],
						},
					},
				},
			],
			[
				{
					requestId: "req_01HQ",
					retrievalAttempted: true,
					candidateCount: 4,
					retrievedSourcesJson: [],
					supportingSourcesJson: [],
					citationCount: 0,
					measuredAt: new Date("2026-03-28T08:00:03.000Z"),
				},
			],
			[],
			[],
		];
		const limit = vi.fn().mockImplementation(async () => responses.shift() ?? []);
		const orderBy = vi.fn().mockImplementation(async () => responses.shift() ?? []);
		const where = vi.fn(() => ({ limit, orderBy }));
		const from = vi.fn(() => ({ where }));
		const select = vi.fn(() => ({ from }));

		createRuntimeDatabase.mockResolvedValue({
			select,
		});

		const store = createPgOperatorQueryStore({} as never, {
			now: () => new Date("2026-03-28T09:00:00.000Z"),
		});

		const result = await store.getObservabilityById("req_01HQ");

		expect(result?.observability.retrievalPlan).toEqual({
			planId: "curriculum:curriculum_plan:current",
			queryMode: "current",
			replanCount: 0,
			terminalState: "completed",
			stepActivities: [
				{
					stepId: "indexed-lookup",
					stepType: "indexed_lookup",
					corpus: "curriculum",
					collection: "curriculum_plan",
					status: "succeeded",
					topK: 8,
					latencyMs: 18,
					candidateCount: 4,
					referenceCount: 4,
					failureKind: null,
				},
			],
		});
	});

	it("returns replay-safe observability sections without raw prompt or raw evidence text", async () => {
		const claimSupportSummary = {
			supportedClaims: 1,
			totalClaims: 2,
			unsupportedClaimTypes: ["offering_unit"],
			unsupportedClaims: 1,
			unsupportedFields: ["offering_unit_claims"],
		};
		const retrievalPlanSummary = {
			planId: "curriculum:curriculum_plan:current",
			queryMode: "current",
			replanCount: 0,
			terminalState: "completed",
			stepActivities: [
				{
					candidateCount: 4,
					collection: "curriculum_plan",
					corpus: "curriculum",
					failureKind: null,
					latencyMs: 18,
					referenceCount: 4,
					status: "succeeded",
					stepId: "indexed-lookup",
					stepType: "indexed_lookup",
					topK: 8,
				},
			],
		};
		const responses = [
			[
				{
					requestId: "req_replay_01HQ",
					traceId: "trace_replay_01HQ",
					conversationId: "conv_replay_01HQ",
					surface: "public_chat_web",
					principalType: "student",
					entitlementSnapshotId: "entitlements-2026-03-29",
					entitlementGroupsJson: ["students"],
					visibilityScope: "main",
					applicabilityScope: "undergraduate",
					status: "no_answer",
					errorCode: null,
					requestedCapability: "knowledge",
					requestedScopeJson: {
						corpus: "curriculum",
						collection: "curriculum_plan",
					},
					resolvedScopeJson: {
						corpus: "curriculum",
						collection: "curriculum_plan",
					},
					selectedTarget: "rag-agent",
					startedAt: new Date("2026-03-28T08:00:00.000Z"),
					completedAt: new Date("2026-03-28T08:00:01.000Z"),
					projectedAt: new Date("2026-03-28T08:00:02.000Z"),
					durationMs: 842,
					diagnosticsJson: {
						claimSupportSummary,
						freshnessFailClosed: true,
						groundingDowngraded: true,
						groundingVerdict: "failed",
						policyReason: "provider_content_filter",
						retrievalAdequacyReason: "insufficient supporting evidence",
						retrievalAdequacyVerdict: "insufficient",
						retrievalPlanSummary,
						scopeClass: "collection_scope",
						semanticOutcome: "unsupported_by_evidence",
					},
				},
			],
			[
				{
					requestId: "req_replay_01HQ",
					aclDecision: "allowed",
					aclAnomalyCode: "fail_open_suspicion",
					candidateCount: 4,
					citationCount: 0,
					citationExpected: true,
					citationMissing: true,
					claimSupportSummaryJson: claimSupportSummary,
					emptyRecall: false,
					failClosed: true,
					measuredAt: new Date("2026-03-28T08:00:03.000Z"),
					modelName: "gpt-5.2-mini",
					modelProvider: "openai",
					policyProjectionVersion: "phase1-authorization-projection-v1",
					policyReason: "provider_content_filter",
					promptId: "rag_answer_v1",
					promptRuntimeDetail: null,
					promptRuntimeState: "content_filter",
					promptVersion: "v1",
					retrievalAdequacyReason: "insufficient supporting evidence",
					retrievalAdequacyVerdict: "insufficient",
					retrievalAttempted: true,
					retrievedSourceCount: 2,
					retrievedSourcesJson: [],
					scopeClass: "collection_scope",
					semanticOutcome: "unsupported_by_evidence",
					supportingSourcesJson: [],
					templateSha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
					traceAvailable: true,
				},
			],
			[],
			[],
		];
		const limit = vi.fn().mockImplementation(async () => responses.shift() ?? []);
		const orderBy = vi.fn().mockImplementation(async () => responses.shift() ?? []);
		const where = vi.fn(() => ({ limit, orderBy }));
		const from = vi.fn(() => ({ where }));
		const select = vi.fn(() => ({ from }));

		createRuntimeDatabase.mockResolvedValue({
			select,
		});

		const store = createPgOperatorQueryStore({} as never, {
			now: () => new Date("2026-03-28T09:00:00.000Z"),
		});

		const result = await store.getObservabilityById("req_replay_01HQ");

		expect(result?.replay).toEqual({
			answerQuality: {
				citationCount: 0,
				citationExpected: true,
				citationMissing: true,
				claimSupportSummary,
				freshnessFailClosed: true,
				groundingDowngraded: true,
				groundingVerdict: "failed",
				policyReason: "provider_content_filter",
			},
			context: {
				applicabilityScope: "undergraduate",
				entitlementGroups: ["students"],
				entitlementSnapshotId: "entitlements-2026-03-29",
				policyProjectionVersion: "phase1-authorization-projection-v1",
				principalType: "student",
				visibilityScope: "main",
			},
			execution: {
				errorCode: null,
				failClosed: true,
				refusalClass: null,
				scopeClass: "collection_scope",
				semanticOutcome: "unsupported_by_evidence",
				status: "no_answer",
			},
			prompt: {
				id: "rag_answer_v1",
				runtimeDetail: null,
				runtimeState: "content_filter",
				templateSha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
				version: "v1",
			},
			retrieval: {
				adequacyReason: "insufficient supporting evidence",
				adequacyVerdict: "insufficient",
				candidateCount: 4,
				emptyRecall: false,
				plan: retrievalPlanSummary,
				retrievalAttempted: true,
				retrievedSourceCount: 2,
				sourceTraceCounts: {
					retrieved: 0,
					supporting: 0,
				},
			},
			routing: {
				requestedCapability: "knowledge",
				requestedScope: {
					collection: "curriculum_plan",
					corpus: "curriculum",
				},
				resolvedScope: {
					collection: "curriculum_plan",
					corpus: "curriculum",
				},
				selectedTarget: "rag-agent",
			},
		});
	});

	it("returns raw versionQuery on request detail and safe version summary on observability detail", async () => {
		const responses = [
			[
				{
					requestId: "req_versioned_01HQ",
					traceId: "trace_versioned_01HQ",
					conversationId: "conv_versioned_01HQ",
					surface: "public_chat_web",
					status: "completed",
					requestedCapability: "knowledge",
					requestedScopeJson: {
						corpus: "regulations",
						collection: "student_rules",
					},
					versionQueryJson: {
						mode: "compare",
						versionId: "v2024-student-rules",
						compareToVersionId: "v2025-student-rules",
					},
					resolvedScopeJson: {
						corpus: "regulations",
						collection: "student_rules",
					},
					selectedTarget: "rag-agent",
					startedAt: new Date("2026-03-28T08:00:00.000Z"),
					completedAt: new Date("2026-03-28T08:00:01.000Z"),
					projectedAt: new Date("2026-03-28T08:00:02.000Z"),
					durationMs: 842,
					diagnosticsJson: null,
				},
			],
			[
				{
					requestId: "req_versioned_01HQ",
					traceId: "trace_versioned_01HQ",
					conversationId: "conv_versioned_01HQ",
					surface: "public_chat_web",
					status: "completed",
					requestedCapability: "knowledge",
					requestedScopeJson: {
						corpus: "regulations",
						collection: "student_rules",
					},
					versionQueryJson: {
						mode: "compare",
						versionId: "v2024-student-rules",
						compareToVersionId: "v2025-student-rules",
					},
					resolvedScopeJson: {
						corpus: "regulations",
						collection: "student_rules",
					},
					selectedTarget: "rag-agent",
					startedAt: new Date("2026-03-28T08:00:00.000Z"),
					completedAt: new Date("2026-03-28T08:00:01.000Z"),
					projectedAt: new Date("2026-03-28T08:00:02.000Z"),
					durationMs: 842,
					diagnosticsJson: null,
				},
			],
			[
				{
					requestId: "req_versioned_01HQ",
					retrievalAttempted: true,
					candidateCount: 4,
					retrievedSourcesJson: [],
					supportingSourcesJson: [],
					citationCount: 0,
					versionQueryMode: "compare",
					versionQuerySummary: "compare:v2024-student-rules->v2025-student-rules",
					measuredAt: new Date("2026-03-28T08:00:03.000Z"),
				},
			],
			[],
			[],
			[],
		];
		const limit = vi.fn().mockImplementation(async () => responses.shift() ?? []);
		const orderBy = vi.fn().mockImplementation(async () => responses.shift() ?? []);
		const where = vi.fn(() => ({ limit, orderBy }));
		const from = vi.fn(() => ({ where }));
		const select = vi.fn(() => ({ from }));

		createRuntimeDatabase.mockResolvedValue({
			select,
		});

		const store = createPgOperatorQueryStore({} as never, {
			now: () => new Date("2026-03-28T09:00:00.000Z"),
		});

		const request = await store.getById("req_versioned_01HQ");
		const observability = await store.getObservabilityById("req_versioned_01HQ");

		expect(request?.versionQuery).toEqual({
			compareToVersionId: "v2025-student-rules",
			mode: "compare",
			versionId: "v2024-student-rules",
		});
		expect(observability?.observability).toMatchObject({
			versionQueryMode: "compare",
			versionQuerySummary: "compare:v2024-student-rules->v2025-student-rules",
		});
	});

	it("derives safety alerts and incident backfill requirements from observability facts", async () => {
		const where = vi.fn().mockResolvedValue([
			{
				durationMs: 10,
				errorCode: "rate_limit_exceeded",
				estimatedCostMicrousd: 0,
				promptRuntimeDetail: null,
				promptRuntimeState: null,
				remoteContentSuspicionSummaryJson: null,
				requestId: "req_rate_1",
				retrievalAttempted: false,
				safetyIdentifier: "safe-rate",
				startedAt: new Date("2026-03-28T08:55:00.000Z"),
				status: "rejected",
				traceAvailable: true,
			},
			{
				durationMs: 10,
				errorCode: "rate_limit_exceeded",
				estimatedCostMicrousd: 0,
				promptRuntimeDetail: null,
				promptRuntimeState: null,
				remoteContentSuspicionSummaryJson: null,
				requestId: "req_rate_2",
				retrievalAttempted: false,
				safetyIdentifier: "safe-rate",
				startedAt: new Date("2026-03-28T08:56:00.000Z"),
				status: "rejected",
				traceAvailable: true,
			},
			{
				durationMs: 10,
				errorCode: "rate_limit_exceeded",
				estimatedCostMicrousd: 0,
				promptRuntimeDetail: null,
				promptRuntimeState: null,
				remoteContentSuspicionSummaryJson: null,
				requestId: "req_rate_3",
				retrievalAttempted: false,
				safetyIdentifier: "safe-rate",
				startedAt: new Date("2026-03-28T08:57:00.000Z"),
				status: "rejected",
				traceAvailable: true,
			},
			{
				durationMs: 20,
				errorCode: null,
				estimatedCostMicrousd: 0,
				promptRuntimeDetail: null,
				promptRuntimeState: null,
				remoteContentSuspicionSummaryJson: {
					flagLabels: ["instructional_imperative"],
					flaggedSourceCount: 1,
					generationBlocked: false,
				},
				requestId: "req_remote_1",
				retrievalAttempted: true,
				safetyIdentifier: "safe-remote",
				startedAt: new Date("2026-03-28T08:52:00.000Z"),
				status: "no_answer",
				traceAvailable: true,
			},
			{
				durationMs: 20,
				errorCode: null,
				estimatedCostMicrousd: 0,
				promptRuntimeDetail: null,
				promptRuntimeState: null,
				remoteContentSuspicionSummaryJson: {
					flagLabels: ["instructional_imperative"],
					flaggedSourceCount: 1,
					generationBlocked: true,
				},
				requestId: "req_remote_2",
				retrievalAttempted: true,
				safetyIdentifier: "safe-remote",
				startedAt: new Date("2026-03-28T08:53:00.000Z"),
				status: "no_answer",
				traceAvailable: true,
			},
			{
				durationMs: 20,
				errorCode: null,
				estimatedCostMicrousd: 0,
				promptRuntimeDetail: null,
				promptRuntimeState: null,
				remoteContentSuspicionSummaryJson: {
					flagLabels: ["instructional_imperative"],
					flaggedSourceCount: 1,
					generationBlocked: false,
				},
				requestId: "req_remote_3",
				retrievalAttempted: true,
				safetyIdentifier: "safe-remote",
				startedAt: new Date("2026-03-28T08:54:00.000Z"),
				status: "no_answer",
				traceAvailable: true,
			},
			{
				durationMs: 30,
				errorCode: null,
				estimatedCostMicrousd: 0,
				promptRuntimeDetail: "content_filter",
				promptRuntimeState: "content_filter",
				remoteContentSuspicionSummaryJson: null,
				requestId: "req_filter_1",
				retrievalAttempted: true,
				safetyIdentifier: "safe-filter",
				startedAt: new Date("2026-03-28T08:50:00.000Z"),
				status: "error",
				traceAvailable: true,
			},
			{
				durationMs: 30,
				errorCode: null,
				estimatedCostMicrousd: 0,
				promptRuntimeDetail: "content_filter",
				promptRuntimeState: "content_filter",
				remoteContentSuspicionSummaryJson: null,
				requestId: "req_filter_2",
				retrievalAttempted: true,
				safetyIdentifier: "safe-filter",
				startedAt: new Date("2026-03-28T08:51:00.000Z"),
				status: "error",
				traceAvailable: true,
			},
			{
				durationMs: 30,
				errorCode: null,
				estimatedCostMicrousd: 0,
				promptRuntimeDetail: "content_filter",
				promptRuntimeState: "content_filter",
				remoteContentSuspicionSummaryJson: null,
				requestId: "req_filter_3",
				retrievalAttempted: true,
				safetyIdentifier: "safe-filter",
				startedAt: new Date("2026-03-28T08:52:30.000Z"),
				status: "error",
				traceAvailable: true,
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

		const store = createPgOperatorQueryStore({} as never, {
			now: () => new Date("2026-03-28T09:00:00.000Z"),
		});

		const result = await store.getOverview({
			collection: null,
			granularity: null,
			modelName: null,
			principalType: null,
			requestedCapability: null,
			selectedTarget: null,
			surface: null,
			window: "24h",
		});

		expect(result.alerts).toHaveLength(3);
		expect(result.alerts).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					alertId: expect.any(String),
					code: "safety.rate_limit_exceeded",
					domain: "safety",
					incidentBackfill: {
						mode: null,
						required: false,
					},
					requestCount: 3,
					severity: "medium",
					startedAt: expect.any(String),
					status: "open",
				}),
				expect.objectContaining({
					alertId: expect.any(String),
					code: "safety.remote_content_suspicion_spike",
					domain: "safety",
					incidentBackfill: {
						mode: "incident_backfill",
						required: true,
					},
					requestCount: 3,
					severity: "high",
					startedAt: expect.any(String),
					status: "open",
				}),
				expect.objectContaining({
					alertId: expect.any(String),
					code: "safety.provider_content_filter_spike",
					domain: "safety",
					incidentBackfill: {
						mode: "incident_backfill",
						required: true,
					},
					requestCount: 3,
					severity: "high",
					startedAt: expect.any(String),
					status: "open",
				}),
			]),
		);
	});

	it("renders operator-facing target labels in safety anomaly summaries", () => {
		expect(
			summarizeSafetyAnomaly({
				aclAnomalyCode: "projection_missing",
				failClosed: false,
				requestedCapability: "knowledge",
				selectedTarget: "rag-agent",
				status: "completed",
			}),
		).toBe("knowledge request finalized without the required policy projection for rag agent.");
	});
});
