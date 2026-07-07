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
		answerText: "国家奖学金按学校现行评审办法执行。",
		error: null,
		followUpQuestion: "",
		observability: null,
		result: null,
		selectedTool: "knowledge_query",
		status: "completed",
		traceId: "trace_usage_01HQ",
		...overrides,
	};
}

describe("request observability usage summary", () => {
	it("projects request usage summary from execution-control observability", () => {
		const fact = buildFinalizedRequestObservabilityFact({
			completedAt: "2026-04-12T08:00:01.000Z",
			conversationId: "conv_usage_01HQ",
			diagnostics: null,
			durationMs: 65000,
			errorCode: null,
			principal: createPrincipal(),
			requestId: "req_usage_01HQ",
			requestedTool: "knowledge_query",
			requestedScope: {
				collection: "student_rules",
				corpus: "regulations",
			},
			resolvedScope: {
				collection: "student_rules",
				corpus: "regulations",
			},
			response: createResponse({
				observability: {
					aclAnomalyCode: null,
					aclDecision: "allowed",
					cachedInputTokens: null,
					candidateCount: 2,
					citationCount: 1,
					citationExpected: true,
					citationMissing: false,
					estimatedCostMicrousd: null,
					failClosed: false,
					inputTokens: null,
					modelName: null,
					modelProvider: null,
					outputTokens: null,
					refusalClass: null,
					retrievedSourceCount: 2,
					retrievalAttempted: true,
					scopeClass: "in_scope",
					semanticOutcome: "grounded_answer",
					usageSummary: {
						billableStepCount: 2,
						cachedInputTokens: 12,
						estimatedCostMicrousd: 60920,
						inputTokens: 18550,
						modelName: null,
						modelProvider: null,
						modelUsage: [
							{
								cachedInputTokens: 0,
								estimatedCostMicrousd: 0,
								inputTokens: 11268,
								modelName: "gpt-5.5",
								modelProvider: "openai",
								outputTokens: 494,
								stepCount: 1,
							},
							{
								cachedInputTokens: 12,
								estimatedCostMicrousd: 60920,
								inputTokens: 7282,
								modelName: "gpt-4.1",
								modelProvider: "openai",
								outputTokens: 817,
								stepCount: 1,
							},
						],
						outputTokens: 1311,
					},
				},
				status: "completed",
			}),
			sourceDocIds: [],
			startedAt: "2026-04-12T08:00:00.000Z",
			status: "completed",
			surface: "campus_web",
			traceId: "trace_usage_01HQ",
			runId: "run_01HQ",
		});

		expect(fact).toMatchObject({
			billableStepCount: 2,
			cachedInputTokens: 12,
			estimatedCostMicrousd: 60920,
			inputTokens: 18550,
			modelName: null,
			modelProvider: null,
			modelUsageSummary: [
				{
					estimatedCostMicrousd: 0,
					inputTokens: 11268,
					modelName: "gpt-5.5",
					modelProvider: "openai",
					outputTokens: 494,
					stepCount: 1,
				},
				{
					estimatedCostMicrousd: 60920,
					inputTokens: 7282,
					modelName: "gpt-4.1",
					modelProvider: "openai",
					outputTokens: 817,
					stepCount: 1,
				},
			],
			outputTokens: 1311,
		});
	});
});
