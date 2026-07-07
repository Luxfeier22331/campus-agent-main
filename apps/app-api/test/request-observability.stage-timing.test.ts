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
			retrievalFilter: {
				entitlementGroups: ["students"],
				policyProjectionVersion: "phase1-authorization-projection-v1",
				visibilityLevel: "public",
				visibilityScope: "main",
			},
			visibilityScope: "main",
		},
		permissions: {
			chat: true,
			operator: false,
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
		selectedTool: "knowledge_query",
		status: "no_answer",
		traceId: "trace_01HQ",
		...overrides,
	};
}

describe("request observability stage timing", () => {
	it("merges execution and app-api owned stage timing into finalized facts", () => {
		const fact = buildFinalizedRequestObservabilityFact({
			completedAt: "2026-04-13T08:00:01.350Z",
			conversationId: "conv_stage_timing_01HQ",
			diagnostics: null,
			durationMs: 1350,
			errorCode: null,
			principal: createPrincipal(),
			projectionCloseoutMs: 17,
			requestId: "req_stage_timing_01HQ",
			requestedTool: "knowledge_query",
			requestedScope: null,
			resolvedScope: null,
			response: createResponse({
				stageTiming: {
					"agent.runtime_ms": 710,
					"memory.recall_ms": 35,
					"tool.total_ms": 920,
				},
				status: "completed",
			}),
			sourceDocIds: [],
			startedAt: "2026-04-13T08:00:00.000Z",
			status: "completed",
			streamBrowserTtftMs: 420,
			surface: "campus_web",
			traceId: "trace_stage_timing_01HQ",
			runId: "run_01HQ",
		});

		expect(fact.stageTiming).toEqual({
			"agent.runtime_ms": 710,
			"memory.recall_ms": 35,
			"projection.closeout_ms": 17,
			"request.total_ms": 1350,
			"stream.browser_ttft_ms": 420,
			"tool.total_ms": 920,
		});
	});

	it("rejects non-canonical app-api stage timing fields in finalized facts", () => {
		expect(() =>
			buildFinalizedRequestObservabilityFact({
				completedAt: "2026-04-13T08:00:01.350Z",
				conversationId: "conv_stage_timing_invalid_01HQ",
				diagnostics: null,
				durationMs: 1350,
				errorCode: null,
				principal: createPrincipal(),
				projectionCloseoutMs: 12,
				requestId: "req_stage_timing_invalid_01HQ",
				requestedTool: "knowledge_query",
				requestedScope: null,
				resolvedScope: null,
				response: createResponse({
					stageTiming: {
						"agent.runtime_ms": 710,
					},
					status: "completed",
				}),
				sourceDocIds: [],
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
