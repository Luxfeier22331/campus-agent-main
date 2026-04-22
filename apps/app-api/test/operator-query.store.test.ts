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
