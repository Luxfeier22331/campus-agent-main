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

import { encodeBase64UrlJson } from "../src/base64url";
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
					intentCapability: "knowledge",
					intentClassifierVersion: "deterministic-intent-v1",
					intentLaunchState: "candidate_only",
					intentNextAction: "delegate",
					intentPolicyReason: null,
					intentScopeClass: "in_scope",
					intentScopeReason: "structured_runtime_candidate_signal",
					intentTaskKind: "knowledge_lookup",
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
		expect(result?.observability.intent).toEqual({
			capability: "knowledge",
			classifierVersion: "deterministic-intent-v1",
			launchState: "candidate_only",
			nextAction: "delegate",
			policyReason: null,
			scopeClass: "in_scope",
			scopeReason: "structured_runtime_candidate_signal",
			taskKind: "knowledge_lookup",
		});
		expect(result?.replay.routing.intent).toEqual({
			capability: "knowledge",
			classifierVersion: "deterministic-intent-v1",
			launchState: "candidate_only",
			nextAction: "delegate",
			policyReason: null,
			scopeClass: "in_scope",
			scopeReason: "structured_runtime_candidate_signal",
			taskKind: "knowledge_lookup",
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

	it("derives overview sink health from projection outbox state", async () => {
		const observabilityRows = [
			{
				durationMs: 100,
				estimatedCostMicrousd: 10,
				requestId: "req_health_01",
				retrievalAttempted: false,
				startedAt: new Date("2026-03-28T08:50:00.000Z"),
				status: "completed",
				traceAvailable: false,
			},
			{
				durationMs: 200,
				estimatedCostMicrousd: 20,
				requestId: "req_health_02",
				retrievalAttempted: false,
				startedAt: new Date("2026-03-28T08:55:00.000Z"),
				status: "completed",
				traceAvailable: true,
			},
		];
		const outboxRows = [
			{
				attemptCount: 2,
				availableAt: new Date("2026-03-28T08:40:00.000Z"),
				eventId: "outbox_failed_stale",
				lastError: "projection write failed",
				processedAt: null,
				requestId: "req_health_01",
			},
			{
				attemptCount: 0,
				availableAt: new Date("2026-03-28T08:59:00.000Z"),
				eventId: "outbox_pending_fresh",
				lastError: null,
				processedAt: null,
				requestId: "req_health_02",
			},
			{
				attemptCount: 1,
				availableAt: new Date("2026-03-28T08:45:00.000Z"),
				eventId: "outbox_recovered",
				lastError: null,
				processedAt: new Date("2026-03-28T08:46:00.000Z"),
				requestId: "req_health_02",
			},
		];
		const responses = [observabilityRows, outboxRows];
		const where = vi.fn().mockImplementation(async () => responses.shift() ?? []);
		const from = vi.fn(() => ({ where }));
		const select = vi.fn(() => ({ from }));

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
			window: "1h",
		});

		expect(result.overview.sinkHealth).toMatchObject({
			missingTraceRate: {
				count: 1,
				eligibleCount: 2,
				value: 0.5,
			},
			outboxPendingCount: 2,
			outboxRetryCount: 2,
			outboxStaleCount: 1,
			projectionFailureCount: 1,
		});
	});

	it("summarizes intent governance signals from request observability facts and intent grades", async () => {
		const observabilityRows = [
			{
				intentAmbiguityReason: null,
				intentAmbiguitySignal: null,
				intentCapability: "knowledge",
				intentClassifierVersion: "intent-classifier@2026-04-20",
				intentContextResolutionState: "resolved",
				intentLaunchState: "open",
				intentNextAction: "delegate",
				intentRoutingConfidence: "high",
				intentSchemaVersion: "intent-schema-1.0.0",
				intentScopeClass: "in_scope",
				intentTaskKind: "knowledge_lookup",
				requestId: "req_intent_01",
				startedAt: new Date("2026-03-28T08:40:00.000Z"),
			},
			{
				intentAmbiguityReason: "missing_slot",
				intentAmbiguitySignal: "ambiguous",
				intentCapability: "campus_services",
				intentClassifierVersion: "intent-classifier@2026-04-20",
				intentContextResolutionState: "unresolved",
				intentLaunchState: "candidate_only",
				intentNextAction: "clarify",
				intentRoutingConfidence: "low",
				intentSchemaVersion: "intent-schema-1.0.0",
				intentScopeClass: "in_scope",
				intentTaskKind: "campus_services_lookup",
				requestId: "req_intent_02",
				startedAt: new Date("2026-03-28T08:45:00.000Z"),
			},
			{
				intentAmbiguityReason: null,
				intentAmbiguitySignal: null,
				intentCapability: "knowledge",
				intentClassifierVersion: "intent-classifier@2026-04-21",
				intentContextResolutionState: "resolved",
				intentLaunchState: "open",
				intentNextAction: "delegate",
				intentRoutingConfidence: "medium",
				intentSchemaVersion: "intent-schema-1.1.0",
				intentScopeClass: "out_of_scope",
				intentTaskKind: "knowledge_lookup",
				requestId: "req_intent_03",
				startedAt: new Date("2026-03-28T08:50:00.000Z"),
			},
		];
		const gradeRows = [
			{
				gradeDomain: "intent",
				requestId: "req_intent_01",
				verdict: "pass",
			},
			{
				gradeDomain: "intent",
				requestId: "req_intent_02",
				verdict: "fail",
			},
		];
		const responses = [observabilityRows, gradeRows];
		const observabilityWhere = vi.fn().mockResolvedValue(responses.shift());
		const gradeOrderBy = vi.fn().mockResolvedValue(responses.shift());
		const gradeWhere = vi.fn(() => ({ orderBy: gradeOrderBy }));
		const select = vi
			.fn()
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: observabilityWhere,
				})),
			})
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: gradeWhere,
				})),
			});

		createRuntimeDatabase.mockResolvedValue({
			select,
		});

		const store = createPgOperatorQueryStore({} as never, {
			now: () => new Date("2026-03-28T09:00:00.000Z"),
		});

		const result = await store.getIntentSummary({
			collection: null,
			granularity: null,
			modelName: null,
			principalType: null,
			requestedCapability: null,
			selectedTarget: null,
			surface: null,
			window: "1h",
		});

		expect(result.runtime.requestCount).toBe(3);
		expect(result.runtime.lowConfidenceRate).toEqual({
			count: 1,
			eligibleCount: 3,
			value: 0.3333,
		});
		expect(result.runtime.ambiguityRate.count).toBe(1);
		expect(result.runtime.contextUnresolvedRate.count).toBe(1);
		expect(result.runtime.distributions.capability).toEqual([
			{ count: 2, value: "knowledge" },
			{ count: 1, value: "campus_services" },
		]);
		expect(result.runtime.distributions.classifierVersion).toEqual([
			{ count: 2, value: "intent-classifier@2026-04-20" },
			{ count: 1, value: "intent-classifier@2026-04-21" },
		]);
		expect(result.sampledGrades?.intentPassRate).toEqual({
			count: 1,
			eligibleCount: 2,
			value: 0.5,
		});
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

	it("returns opaque quality badcase cursors for the last visible row", async () => {
		const badcaseRows = [
			{
				badcaseId: "badcase_01",
				causeClass: "unknown_runtime_failure",
				detectedBy: "runtime_monitor",
				gradeJson: null,
				openedAt: new Date("2026-04-01T10:00:00.000Z"),
				requestId: "req_01",
				selectedTarget: "rag-agent",
				status: "open",
				summary: "First badcase",
				surface: "public_chat_web",
				traceId: "trace_01",
			},
			{
				badcaseId: "badcase_02",
				causeClass: "unknown_runtime_failure",
				detectedBy: "runtime_monitor",
				gradeJson: null,
				openedAt: new Date("2026-04-01T09:00:00.000Z"),
				requestId: "req_02",
				selectedTarget: "rag-agent",
				status: "open",
				summary: "Second badcase",
				surface: "public_chat_web",
				traceId: "trace_02",
			},
		];
		const badcaseLimit = vi.fn().mockResolvedValue(badcaseRows);
		const badcaseOrderBy = vi.fn(() => ({ limit: badcaseLimit }));
		const backlinkWhere = vi.fn().mockResolvedValue([]);

		const select = vi
			.fn()
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					orderBy: badcaseOrderBy,
				})),
			})
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: backlinkWhere,
				})),
			});

		createRuntimeDatabase.mockResolvedValue({
			select,
		});

		const store = createPgOperatorQueryStore({} as never);
		const result = await store.listQualityBadcases({
			causeClass: null,
			cursor: null,
			detectedBy: null,
			limit: 1,
			status: null,
		});

		expect(result.badcases).toHaveLength(1);
		expect(result.page.nextCursor).toBe(
			encodeBase64UrlJson({
				badcaseId: "badcase_01",
				openedAt: "2026-04-01T10:00:00.000Z",
			}),
		);
		expect(result.page.nextCursor).not.toBe("badcase_02");
	});

	it("returns opaque request cursors for the last visible row", async () => {
		const requestRows = [
			{
				answerPreview: "First answer",
				completedAt: new Date("2026-04-01T10:00:01.000Z"),
				conversationId: "conv_01",
				createdAt: new Date("2026-04-01T10:00:00.000Z"),
				diagnosticsJson: null,
				durationMs: 100,
				errorCode: null,
				principalDisplayName: "Student One",
				principalId: "student_01",
				principalType: "campus_member",
				projectedAt: new Date("2026-04-01T10:00:02.000Z"),
				queryPreview: "First question",
				requestedCapability: "knowledge",
				requestedScopeJson: null,
				requestId: "req_01",
				resolvedScopeJson: null,
				selectedTarget: "rag-agent",
				sourceDocIdsJson: [],
				startedAt: new Date("2026-04-01T10:00:00.000Z"),
				status: "completed",
				surface: "public_chat_web",
				traceId: "trace_01",
				updatedAt: new Date("2026-04-01T10:00:02.000Z"),
				versionQueryJson: null,
			},
			{
				answerPreview: "Second answer",
				completedAt: new Date("2026-04-01T09:00:01.000Z"),
				conversationId: "conv_02",
				createdAt: new Date("2026-04-01T09:00:00.000Z"),
				diagnosticsJson: null,
				durationMs: 100,
				errorCode: null,
				principalDisplayName: "Student Two",
				principalId: "student_02",
				principalType: "campus_member",
				projectedAt: new Date("2026-04-01T09:00:02.000Z"),
				queryPreview: "Second question",
				requestedCapability: "knowledge",
				requestedScopeJson: null,
				requestId: "req_02",
				resolvedScopeJson: null,
				selectedTarget: "rag-agent",
				sourceDocIdsJson: [],
				startedAt: new Date("2026-04-01T09:00:00.000Z"),
				status: "completed",
				surface: "public_chat_web",
				traceId: "trace_02",
				updatedAt: new Date("2026-04-01T09:00:02.000Z"),
				versionQueryJson: null,
			},
		];
		const requestLimit = vi.fn().mockResolvedValue(requestRows);
		const requestOrderBy = vi.fn(() => ({ limit: requestLimit }));
		const select = vi.fn().mockReturnValueOnce({
			from: vi.fn(() => ({
				orderBy: requestOrderBy,
			})),
		});

		createRuntimeDatabase.mockResolvedValue({
			select,
		});

		const store = createPgOperatorQueryStore({} as never);
		const result = await store.list({
			conversationId: null,
			cursor: null,
			limit: 1,
			q: null,
			requestId: null,
			status: null,
			surface: null,
		});

		expect(result.requests).toHaveLength(1);
		expect(result.page.nextCursor).toBe(
			encodeBase64UrlJson({
				requestId: "req_01",
				startedAt: "2026-04-01T10:00:00.000Z",
			}),
		);
		expect(result.page.nextCursor).not.toBe(
			encodeBase64UrlJson({
				requestId: "req_02",
				startedAt: "2026-04-01T09:00:00.000Z",
			}),
		);
	});

	it("returns opaque audit cursors for the last visible row", async () => {
		const auditRows = [
			{
				auditEventId: "audit_01",
				eventType: "request.completed",
				metadataJson: null,
				occurredAt: new Date("2026-04-01T10:00:00.000Z"),
				principalId: "student_01",
				principalType: "campus_member",
				requestId: "req_01",
				selectedTarget: "rag-agent",
				status: "completed",
				summary: "First event",
				surface: "public_chat_web",
				traceId: "trace_01",
			},
			{
				auditEventId: "audit_02",
				eventType: "request.completed",
				metadataJson: null,
				occurredAt: new Date("2026-04-01T09:00:00.000Z"),
				principalId: "student_02",
				principalType: "campus_member",
				requestId: "req_02",
				selectedTarget: "rag-agent",
				status: "completed",
				summary: "Second event",
				surface: "public_chat_web",
				traceId: "trace_02",
			},
		];
		const auditLimit = vi.fn().mockResolvedValue(auditRows);
		const auditOrderBy = vi.fn(() => ({ limit: auditLimit }));
		const select = vi.fn().mockReturnValueOnce({
			from: vi.fn(() => ({
				orderBy: auditOrderBy,
			})),
		});

		createRuntimeDatabase.mockResolvedValue({
			select,
		});

		const store = createPgOperatorQueryStore({} as never);
		const result = await store.listAudit({
			cursor: null,
			eventType: null,
			limit: 1,
			principalType: null,
			requestId: null,
			selectedTarget: null,
			status: null,
			surface: null,
			traceId: null,
		});

		expect(result.events).toHaveLength(1);
		expect(result.page.nextCursor).toBe(
			encodeBase64UrlJson({
				auditEventId: "audit_01",
				occurredAt: "2026-04-01T10:00:00.000Z",
			}),
		);
		expect(result.page.nextCursor).not.toBe(
			encodeBase64UrlJson({
				auditEventId: "audit_02",
				occurredAt: "2026-04-01T09:00:00.000Z",
			}),
		);
	});

	it("returns opaque safety anomaly cursors for the last visible row", async () => {
		const anomalyRows = [
			{
				aclAnomalyCode: "projection_missing",
				failClosed: false,
				principalType: "campus_member",
				requestedCapability: "knowledge",
				requestId: "req_01",
				selectedTarget: "rag-agent",
				startedAt: new Date("2026-04-01T10:00:00.000Z"),
				status: "completed",
				surface: "public_chat_web",
				traceId: "trace_01",
			},
			{
				aclAnomalyCode: "projection_missing",
				failClosed: false,
				principalType: "campus_member",
				requestedCapability: "knowledge",
				requestId: "req_02",
				selectedTarget: "rag-agent",
				startedAt: new Date("2026-04-01T09:00:00.000Z"),
				status: "completed",
				surface: "public_chat_web",
				traceId: "trace_02",
			},
		];
		const anomalyOrderBy = vi.fn().mockResolvedValue(anomalyRows);
		const anomalyWhere = vi.fn(() => ({ orderBy: anomalyOrderBy }));
		const backlinkWhere = vi.fn().mockResolvedValue([]);
		const select = vi
			.fn()
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: anomalyWhere,
				})),
			})
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: backlinkWhere,
				})),
			});

		createRuntimeDatabase.mockResolvedValue({
			select,
		});

		const store = createPgOperatorQueryStore({} as never);
		const result = await store.listSafetyAnomalies({
			anomalyCode: null,
			cursor: null,
			limit: 1,
			severity: null,
			status: null,
		});

		expect(result.anomalies).toHaveLength(1);
		expect(result.page.nextCursor).toBe(
			encodeBase64UrlJson({
				detectedAt: "2026-04-01T10:00:00.000Z",
				requestId: "req_01",
			}),
		);
		expect(result.page.nextCursor).not.toBe(
			encodeBase64UrlJson({
				detectedAt: "2026-04-01T09:00:00.000Z",
				requestId: "req_02",
			}),
		);
	});

	it("applies quality badcase cursor filters before ordering the next page", async () => {
		const cursor = encodeBase64UrlJson({
			badcaseId: "badcase_02",
			openedAt: "2026-04-01T09:00:00.000Z",
		});
		const badcaseLimit = vi.fn().mockResolvedValue([]);
		const badcaseOrderBy = vi.fn(() => ({ limit: badcaseLimit }));
		const badcaseWhere = vi.fn(() => ({ orderBy: badcaseOrderBy }));
		const select = vi.fn().mockReturnValueOnce({
			from: vi.fn(() => ({
				orderBy: badcaseOrderBy,
				where: badcaseWhere,
			})),
		});

		createRuntimeDatabase.mockResolvedValue({
			select,
		});

		const store = createPgOperatorQueryStore({} as never);
		await store.listQualityBadcases({
			causeClass: null,
			cursor,
			detectedBy: null,
			limit: 10,
			status: null,
		});

		expect(badcaseWhere).toHaveBeenCalledTimes(1);
	});

	it("attaches intent grades to intent classifier badcases", async () => {
		const badcaseRows = [
			{
				badcaseId: "badcase_intent_01",
				causeClass: "intent_classifier_mismatch",
				detectedBy: "runtime_monitor",
				gradeJson: null,
				openedAt: new Date("2026-04-01T10:00:00.000Z"),
				requestId: "req_intent_01",
				selectedTarget: "supervisor-core",
				status: "open",
				summary: "Intent classifier selected the wrong target",
				surface: "public_chat_web",
				traceId: "trace_intent_01",
			},
		];
		const gradeRows = [
			{
				gradeDomain: "intent",
				gradeId: "grade_intent_01",
				graderVersion: "intent-grader@2026-04-20",
				projectedAt: new Date("2026-04-01T10:00:04.000Z"),
				requestId: "req_intent_01",
				requestStartedAt: new Date("2026-04-01T09:59:58.000Z"),
				sampledAt: new Date("2026-04-01T10:00:03.000Z"),
				scoreMilli: 120,
				verdict: "fail",
			},
		];
		const badcaseLimit = vi.fn().mockResolvedValue(badcaseRows);
		const badcaseOrderBy = vi.fn(() => ({ limit: badcaseLimit }));
		const backlinkWhere = vi.fn().mockResolvedValue([]);
		const gradeOrderBy = vi.fn().mockResolvedValue(gradeRows);
		const gradeWhere = vi.fn(() => ({ orderBy: gradeOrderBy }));

		const select = vi
			.fn()
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					orderBy: badcaseOrderBy,
				})),
			})
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: backlinkWhere,
				})),
			})
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: gradeWhere,
				})),
			});

		createRuntimeDatabase.mockResolvedValue({
			select,
		});

		const store = createPgOperatorQueryStore({} as never);
		const result = await store.listQualityBadcases({
			causeClass: null,
			cursor: null,
			detectedBy: null,
			limit: 10,
			status: null,
		});

		expect(result.badcases[0]?.grade).toEqual({
			graderVersion: "intent-grader@2026-04-20",
			result: "fail",
			score: 0.12,
		});
	});

	it("keeps same-request badcase grades scoped to each inferred quality domain", async () => {
		const badcaseRows = [
			{
				badcaseId: "badcase_citation_01",
				causeClass: "citation_missing",
				detectedBy: "runtime_monitor",
				gradeJson: null,
				openedAt: new Date("2026-04-01T10:00:00.000Z"),
				requestId: "req_shared_01",
				selectedTarget: "rag-agent",
				status: "open",
				summary: "Citation missing",
				surface: "public_chat_web",
				traceId: "trace_shared_01",
			},
			{
				badcaseId: "badcase_intent_01",
				causeClass: "intent_classifier_mismatch",
				detectedBy: "runtime_monitor",
				gradeJson: null,
				openedAt: new Date("2026-04-01T09:59:00.000Z"),
				requestId: "req_shared_01",
				selectedTarget: "supervisor-core",
				status: "open",
				summary: "Intent classifier selected the wrong target",
				surface: "public_chat_web",
				traceId: "trace_shared_01",
			},
		];
		const gradeRows = [
			{
				gradeDomain: "intent",
				gradeId: "grade_intent_01",
				graderVersion: "intent-grader@2026-04-20",
				projectedAt: new Date("2026-04-01T10:00:04.000Z"),
				requestId: "req_shared_01",
				requestStartedAt: new Date("2026-04-01T09:59:58.000Z"),
				sampledAt: new Date("2026-04-01T10:00:03.000Z"),
				scoreMilli: 120,
				verdict: "fail",
			},
			{
				gradeDomain: "citation",
				gradeId: "grade_citation_01",
				graderVersion: "citation-grader@2026-04-20",
				projectedAt: new Date("2026-04-01T10:00:02.000Z"),
				requestId: "req_shared_01",
				requestStartedAt: new Date("2026-04-01T09:59:58.000Z"),
				sampledAt: new Date("2026-04-01T10:00:01.000Z"),
				scoreMilli: 900,
				verdict: "pass",
			},
		];
		const badcaseLimit = vi.fn().mockResolvedValue(badcaseRows);
		const badcaseOrderBy = vi.fn(() => ({ limit: badcaseLimit }));
		const backlinkWhere = vi.fn().mockResolvedValue([]);
		const gradeOrderBy = vi.fn().mockResolvedValue(gradeRows);
		const gradeWhere = vi.fn(() => ({ orderBy: gradeOrderBy }));

		const select = vi
			.fn()
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					orderBy: badcaseOrderBy,
				})),
			})
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: backlinkWhere,
				})),
			})
			.mockReturnValueOnce({
				from: vi.fn(() => ({
					where: gradeWhere,
				})),
			});

		createRuntimeDatabase.mockResolvedValue({
			select,
		});

		const store = createPgOperatorQueryStore({} as never);
		const result = await store.listQualityBadcases({
			causeClass: null,
			cursor: null,
			detectedBy: null,
			limit: 10,
			status: null,
		});

		expect(result.badcases).toEqual([
			expect.objectContaining({
				badcaseId: "badcase_citation_01",
				grade: {
					graderVersion: "citation-grader@2026-04-20",
					result: "pass",
					score: 0.9,
				},
			}),
			expect.objectContaining({
				badcaseId: "badcase_intent_01",
				grade: {
					graderVersion: "intent-grader@2026-04-20",
					result: "fail",
					score: 0.12,
				},
			}),
		]);
	});
});
