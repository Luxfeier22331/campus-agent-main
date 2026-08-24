// @vitest-environment node

import { describe, expect, it } from "vitest";

import type { ResolvedAppPrincipal } from "../src/modules/auth";
import type { ToolExecutionResponse } from "../src/modules/integration";
import {
	buildAcceptedRequestObservabilityFact,
	buildFinalizedRequestObservabilityFact,
} from "../src/modules/request-observability";

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
		observability: null,
		result: null,
		status: "completed",
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

function buildFinalizedFact(
	overrides: Partial<Parameters<typeof buildFinalizedRequestObservabilityFact>[0]> = {},
) {
	return buildFinalizedRequestObservabilityFact({
		completedAt: "2026-04-05T08:00:01.000Z",
		conversationId: "conv_01HQ",
		durationMs: 1000,
		errorCode: null,
		principal: createPrincipal(),
		requestId: "req_01HQ",
		response: createResponse(),
		runId: "run_01HQ",
		safetyIdentifier: null,
		startedAt: "2026-04-05T08:00:00.000Z",
		status: "completed",
		surface: "campus_web",
		traceId: "trace_01HQ",
		...overrides,
	});
}

describe("request observability", () => {
	it("carries request identity and terminal facts without duplicating model usage", () => {
		const safetyIdentifier = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
		const accepted = buildAcceptedRequestObservabilityFact({
			conversationId: "conv_01HQ",
			principal: createPrincipal(),
			requestId: "req_01HQ",
			safetyIdentifier,
			startedAt: "2026-04-05T08:00:00.000Z",
			surface: "campus_web",
			traceId: "trace_01HQ",
		});
		const finalized = buildFinalizedFact({
			response: createResponse({ status: "completed" }),
			safetyIdentifier,
			status: "completed",
		});

		expect(accepted).toMatchObject({
			safetyIdentifier,
			status: "accepted",
		});
		expect(finalized).toMatchObject({
			aclDecision: "allowed",
			failClosed: false,
			safetyIdentifier,
			status: "completed",
		});
		expect(finalized).not.toHaveProperty("inputTokens");
		expect(finalized).not.toHaveProperty("cachedInputTokens");
		expect(finalized).not.toHaveProperty("outputTokens");
		expect(finalized).not.toHaveProperty("totalTokens");
	});

	it("derives policy facts from the final status", () => {
		const completed = buildFinalizedFact();
		const rejected = buildFinalizedFact({
			errorCode: "request_rejected",
			response: createResponse({ status: "rejected" }),
			status: "rejected",
		});

		expect(completed).toMatchObject({
			aclDecision: "allowed",
			failClosed: false,
		});
		expect(rejected).toMatchObject({
			aclDecision: "denied",
			failClosed: true,
			policyReason: "request_rejected",
		});
		expect(completed).not.toHaveProperty("refusalClass");
		expect(completed).not.toHaveProperty("semanticOutcome");
		expect(rejected).not.toHaveProperty("refusalClass");
		expect(rejected).not.toHaveProperty("semanticOutcome");
	});

	it("persists official workflow and trace projections without raw runtime payloads", () => {
		const workflowTraceSummary = {
			answerArtifactRefs: ["projection://run_01HQ/agent/final"],
			executionPath: "tool_assisted" as const,
			runtimeVersions: { agentRuntime: "openai_agents_sdk" },
			terminalReason: "answer",
		};
		const fact = buildFinalizedFact({
			response: createResponse({
				status: "completed",
				workflowTraceSummary,
			}),
			status: "completed",
		});

		expect(fact.workflowTraceSummary).toEqual(workflowTraceSummary);
		expect(JSON.stringify(fact)).not.toContain("raw_prompt");
		expect(JSON.stringify(fact)).not.toContain("raw_answer");
	});
});
