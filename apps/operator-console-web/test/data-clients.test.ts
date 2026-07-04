import { afterEach, describe, expect, it, vi } from "vitest";

import { getOperatorOverview, getOperatorRuntimeHealth } from "../src/panel/data-provider/operator";
import { getRequestDetail, getRequestList } from "../src/panel/data-provider/requests";
import { mockJsonFetch } from "./data-provider.test-support";

describe("Operator Console minimal data clients", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("maps request list filters onto the protected same-site request projection", async () => {
		const fetchSpy = mockJsonFetch({
			page: { nextCursor: null },
			requests: [
				{
					answerPreview: "图书馆开放到 22:00。",
					completedAt: "2026-03-28T08:00:01.000Z",
					conversationId: "conv_01HQ",
					durationMs: 812,
					errorCode: null,
					principalId: "user_01HQ",
					principalLabel: "Jane Doe",
					principalType: "campus_member",
					projectedAt: "2026-03-28T08:00:02.000Z",
					questionPreview: "图书馆开放到几点？",
					requestId: "req_01HQ",
					requestedTool: "knowledge_query",
					requestedScope: null,
					selectedTool: "knowledge_query",
					sourceDocIds: [],
					startedAt: "2026-03-28T08:00:00.000Z",
					status: "completed",
					surface: "campus_web",
					traceId: "trace_01HQ",
				},
			],
		});

		const response = await getRequestList({
			filter: { q: "图书馆", status: "completed" },
			pagination: { page: 1, perPage: 20 },
		});

		expect(response.data[0]).toMatchObject({
			id: "req_01HQ",
			requestId: "req_01HQ",
			status: "completed",
		});
		expect(fetchSpy).toHaveBeenCalledWith(
			"/api/requests?limit=20&q=%E5%9B%BE%E4%B9%A6%E9%A6%86&status=completed",
			expect.objectContaining({ method: "GET" }),
		);
	});

	it("loads operator overview and runtime health without quality/eval governance clients", async () => {
		const fetchSpy = mockJsonFetch(
			{
				asOf: "2026-06-16T08:00:00.000Z",
				overview: {
					failureRate: { count: 0, eligibleCount: 1, value: 0 },
					latency: { p50Ms: 100, p95Ms: 200, p99Ms: 300 },
					requestVolume: { accepted: 1, completed: 1, errored: 0 },
					sinkHealth: {
						missingTraceRate: { count: 0, eligibleCount: 1, value: 0 },
						outboxPendingCount: 0,
						outboxRetryCount: 0,
						outboxStaleCount: 0,
						projectionFailureCount: 0,
					},
				},
				window: {
					from: "2026-06-15T08:00:00.000Z",
					granularity: "1h",
					to: "2026-06-16T08:00:00.000Z",
				},
			},
			{
				asOf: "2026-06-16T08:00:00.000Z",
				executionRuntime: {
					blockers: {},
					checks: { runProjectionStore: "ready", temporalRuntime: "ready" },
					status: "ready",
				},
				runProjectionStore: null,
				status: "ready",
				temporalRuntime: null,
			},
		);

		await expect(getOperatorOverview({ window: "24h" })).resolves.toMatchObject({
			data: { overview: { requestVolume: { completed: 1 } } },
		});
		await expect(getOperatorRuntimeHealth()).resolves.toMatchObject({
			data: { executionRuntime: { status: "ready" } },
		});
		expect(fetchSpy.mock.calls.map((call) => call[0])).toEqual([
			"/api/operator/overview?window=24h",
			"/api/operator/runtime/health",
		]);
	});

	it("loads request detail through the same-site panel route", async () => {
		const fetchSpy = mockJsonFetch({
			opsIndex: {
				debugTraceRefs: [
					{
						sink: "langfuse",
						traceId: "trace_01HQ",
						traceRef: "lf_trace_01HQ",
						url: "https://langfuse.example/project/traces/lf_trace_01HQ",
					},
				],
				model: {
					billableStepCount: 2,
					cachedInputTokens: 12,
					estimatedCostMicrousd: 120,
					executionDetail: "completed",
					executionState: "completed",
					inputTokens: 300,
					modelName: "gpt-test",
					modelProvider: "openai",
					outputTokens: 80,
					promptId: "campus-primary-agent",
					promptVersion: "current",
					templateSha256: "sha256-template",
					usageSummary: [],
				},
				retrieval: {
					adequacyReason: "enough_evidence",
					adequacyVerdict: "adequate",
					candidateCount: 8,
					collection: "student_rules",
					retrievalAttempted: true,
					retrievedSourceCount: 3,
				},
				sinkLinks: {
					projectionLagMs: 250,
					traceAvailable: true,
				},
				stageTiming: {
					"agent.primary_ms": 620,
				},
				tool: {
					failClosed: false,
					failCloseReason: null,
					historicalDowngradeReason: null,
					requestedTool: "knowledge_query",
					selectedTool: "knowledge_query",
					toolBusinessOutcome: "answered",
				},
			},
			request: {
				answerPreview: "图书馆开放到 22:00。",
				completedAt: "2026-03-28T08:00:01.000Z",
				conversationId: "conv_01HQ",
				durationMs: 812,
				errorCode: null,
				principalId: "user_01HQ",
				principalLabel: "Jane Doe",
				principalType: "campus_member",
				projectedAt: "2026-03-28T08:00:02.000Z",
				questionPreview: "图书馆开放到几点？",
				requestId: "req_01HQ",
				requestedTool: "knowledge_query",
				requestedScope: null,
				selectedTool: "knowledge_query",
				sourceDocIds: [],
				startedAt: "2026-03-28T08:00:00.000Z",
				status: "completed",
				surface: "campus_web",
				traceId: "trace_01HQ",
			},
		});

		await expect(getRequestDetail({ requestId: "req_01HQ" })).resolves.toMatchObject({
			opsIndex: {
				model: {
					modelName: "gpt-test",
					modelProvider: "openai",
				},
				stageTiming: {
					"agent.primary_ms": 620,
				},
			},
			request: {
				id: "req_01HQ",
				requestId: "req_01HQ",
			},
		});
		expect(fetchSpy.mock.calls.map((call) => call[0])).toEqual(["/api/requests/req_01HQ"]);
	});
});
