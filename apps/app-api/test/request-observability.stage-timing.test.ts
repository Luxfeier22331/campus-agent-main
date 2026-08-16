// @vitest-environment node

import { describe, expect, it } from "vitest";

import type { ResolvedAppPrincipal } from "../src/modules/auth";
import type { ToolExecutionResponse } from "../src/modules/integration";
import { buildFinalizedRequestObservabilityFact } from "../src/modules/request-observability";

function createPrincipal(): ResolvedAppPrincipal {
	return {
		actor: {
			departments: [],
			principalId: "principal_01HQ",
			principalType: "student",
			roles: [],
			userId: "user_01HQ",
		},
		authorization: {
			approvalState: "not_required",
			applicabilityScope: "undergraduate",
			entitlementGroups: ["students"],
			entitlementSnapshotId: "entitlements-2026-03-29",
			ownershipScopes: [],
			principalId: "principal_01HQ",
			projectionSource: "campus_identity",
			visibilityScope: "main",
		},
		permissions: {
			chat: true,
		},
		principal: {
			displayName: "Jane Doe",
			email: "jane@example.edu.cn",
			principalId: "principal_01HQ",
			type: "student",
		},
		session: null,
	};
}

function createResponse(overrides: Partial<ToolExecutionResponse> = {}): ToolExecutionResponse {
	return {
		answerText: "当前没有足够依据回答这个问题。",
		error: null,
		followUpQuestion: "",
		observability: null,
		result: null,
		status: "no_answer",
		traceId: "trace_01HQ",
		...overrides,
		modelUsage: overrides.modelUsage ?? {
			cachedInputTokens: 10,
			inputTokens: 120,
			outputTokens: 42,
			totalTokens: 162,
		},
	};
}

describe("request observability stage timing", () => {
	it("merges execution and app-api owned stage timing into finalized facts", () => {
		const fact = buildFinalizedRequestObservabilityFact({
			completedAt: "2026-04-13T08:00:01.350Z",
			conversationId: "conv_stage_timing_01HQ",
			durationMs: 1350,
			errorCode: null,
			principal: createPrincipal(),
			projectionCloseoutMs: 17,
			requestId: "req_stage_timing_01HQ",
			response: createResponse({
				stageTiming: {
					"agent.first_delta_ms": 300,
					"agent.runtime_ms": 710,
					"memory.recall_ms": 35,
					"tool.total_ms": 920,
				},
				status: "completed",
			}),
			startedAt: "2026-04-13T08:00:00.000Z",
			status: "completed",
			streamAppApiTtftMs: 420,
			surface: "campus_web",
			traceId: "trace_stage_timing_01HQ",
			runId: "run_01HQ",
		});

		expect(fact.stageTiming).toEqual({
			"agent.first_delta_ms": 300,
			"agent.runtime_ms": 710,
			"memory.recall_ms": 35,
			"projection.closeout_ms": 17,
			"request.total_ms": 1350,
			"stream.app_api_ttft_ms": 420,
			"stream.orchestration_overhead_ms": 120,
			"tool.total_ms": 920,
		});
	});

	it("omits orchestration overhead when app-api observes a shorter duration than agent runtime", () => {
		const fact = buildFinalizedRequestObservabilityFact({
			completedAt: "2026-04-13T08:00:01.350Z",
			conversationId: "conv_stage_timing_clock_01HQ",
			durationMs: 1350,
			errorCode: null,
			principal: createPrincipal(),
			requestId: "req_stage_timing_clock_01HQ",
			response: createResponse({
				stageTiming: { "agent.first_delta_ms": 500 },
				status: "completed",
			}),
			startedAt: "2026-04-13T08:00:00.000Z",
			status: "completed",
			streamAppApiTtftMs: 420,
			surface: "campus_web",
			traceId: "trace_stage_timing_clock_01HQ",
			runId: "run_01HQ",
		});

		expect(fact.stageTiming).toMatchObject({
			"agent.first_delta_ms": 500,
			"stream.app_api_ttft_ms": 420,
		});
		expect(fact.stageTiming).not.toHaveProperty("stream.orchestration_overhead_ms");
	});

	it("preserves the first persisted app-api TTFT when a later subscriber observes another value", () => {
		const fact = buildFinalizedRequestObservabilityFact({
			completedAt: "2026-04-13T08:00:02.500Z",
			conversationId: "conv_stage_timing_first_value_01HQ",
			durationMs: 2500,
			errorCode: null,
			principal: createPrincipal(),
			requestId: "req_stage_timing_first_value_01HQ",
			response: createResponse({
				stageTiming: { "agent.first_delta_ms": 800 },
				status: "completed",
			}),
			startedAt: "2026-04-13T08:00:00.000Z",
			status: "completed",
			stageTiming: {
				"stream.app_api_ttft_ms": 1800,
			},
			streamAppApiTtftMs: 2200,
			surface: "campus_web",
			traceId: "trace_stage_timing_first_value_01HQ",
			runId: "run_01HQ",
		});

		expect(fact.stageTiming).toMatchObject({
			"agent.first_delta_ms": 800,
			"stream.app_api_ttft_ms": 1800,
			"stream.orchestration_overhead_ms": 1000,
		});
	});

	it("rejects non-canonical app-api stage timing fields in finalized facts", () => {
		expect(() =>
			buildFinalizedRequestObservabilityFact({
				completedAt: "2026-04-13T08:00:01.350Z",
				conversationId: "conv_stage_timing_invalid_01HQ",
				durationMs: 1350,
				errorCode: null,
				principal: createPrincipal(),
				projectionCloseoutMs: 12,
				requestId: "req_stage_timing_invalid_01HQ",
				response: createResponse({
					stageTiming: {
						"agent.runtime_ms": 710,
					},
					status: "completed",
				}),
				startedAt: "2026-04-13T08:00:00.000Z",
				status: "completed",
				stageTiming: {
					"app_api.synthetic_ms": 1,
				},
				surface: "campus_web",
				traceId: "trace_stage_timing_invalid_01HQ",
				runId: "run_01HQ",
			}),
		).toThrow("stage_timing.app_api.synthetic_ms is not an allowed stage timing field");
	});
});
