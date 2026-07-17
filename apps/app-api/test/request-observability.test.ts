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
		resolvedTargets: overrides.resolvedTargets ?? [],
		sessionUpdate: overrides.sessionUpdate ?? null,
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
		requestedTool: "knowledge_query",
		resolvedTargets: ["student_rules"],
		response: createResponse(),
		runId: "run_01HQ",
		safetyIdentifier: null,
		startedAt: "2026-04-05T08:00:00.000Z",
		status: "no_answer",
		surface: "campus_web",
		traceId: "trace_01HQ",
		...overrides,
	});
}

describe("request observability", () => {
	it("carries request identity and resolved targets through acceptance and finalization", () => {
		const safetyIdentifier = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
		const accepted = buildAcceptedRequestObservabilityFact({
			conversationId: "conv_01HQ",
			principal: createPrincipal(),
			requestId: "req_01HQ",
			requestedTool: "knowledge_query",
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
			resolvedTargets: [],
			safetyIdentifier,
			status: "accepted",
		});
		expect(finalized).toMatchObject({
			aclDecision: "allowed",
			failClosed: false,
			resolvedTargets: ["student_rules"],
			safetyIdentifier,
			semanticOutcome: "answer",
			status: "completed",
		});
	});

	it("derives terminal policy facts from the final status", () => {
		const noAnswer = buildFinalizedFact();
		const rejected = buildFinalizedFact({
			errorCode: "request_rejected",
			resolvedTargets: [],
			response: createResponse({ status: "rejected" }),
			status: "rejected",
		});

		expect(noAnswer).toMatchObject({
			aclDecision: "allowed",
			failClosed: true,
			refusalClass: "no_answer",
			semanticOutcome: "no_answer",
		});
		expect(rejected).toMatchObject({
			aclDecision: "denied",
			failClosed: true,
			policyReason: "request_rejected",
			refusalClass: "rejected",
			semanticOutcome: "policy_refusal",
		});
	});

	it("projects only trusted top-level result sources", () => {
		const fact = buildFinalizedFact({
			response: createResponse({
				result: {
					evidence: {
						sources: [
							{
								doc_id: "legacy-doc",
								source_title: "旧来源",
							},
						],
					},
					sources: [
						{
							canonical_url:
								"/docs/regulations/student_rules/leave-policy?chunk=raw#legacy-fragment",
							source_kind: "regulation",
							source_title: "学生请假管理规定",
							target_kind: "canonical_reader",
							version_id: "student-rules-current",
						},
						{
							canonical_url: "/docs/incomplete",
						},
					],
				},
				status: "completed",
			}),
			status: "completed",
		});

		expect(fact.supportingSources).toEqual([
			{
				canonicalUrl: "/docs/regulations/student_rules/leave-policy",
				sourceKind: "regulation",
				sourceTitle: "学生请假管理规定",
				targetKind: "canonical_reader",
				versionId: "student-rules-current",
			},
		]);
	});

	it("persists official workflow and trace projections without raw runtime payloads", () => {
		const workflowTraceSummary = {
			answerArtifactKinds: ["agent_final_output"],
			answerArtifactRefs: ["projection://run_01HQ/agent/final"],
			directVsDelegateBranch: "knowledge_agent",
			firstDecisionActor: "primary_agent",
			planningOutcome: "primary_agent_completed",
			runtimeVersions: { agentRuntime: "openai_agents_sdk" },
			selectedTool: "knowledge_query",
			selectedTools: ["knowledge_query"],
			terminalReason: "answer",
			workflowMode: "single_step",
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
