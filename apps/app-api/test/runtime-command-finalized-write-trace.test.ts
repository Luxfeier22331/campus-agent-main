// @vitest-environment node

import { describe, expect, it } from "vitest";

import type { ResolvedAppPrincipal } from "../src/modules/auth";
import type { ChatConversation } from "../src/modules/chat";
import type { ToolExecutionResponse } from "../src/modules/integration";
import { buildFinalizedWrite } from "../src/modules/runtime-command/service/writes";

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
			entitlementSnapshotId: "entitlements_01HQ",
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

function createConversation(): ChatConversation {
	return {
		createdAt: "2026-06-04T01:02:00.000Z",
		id: "conv_01HQ",
		messages: [],
		ownerUserId: "user_01HQ",
		sessionSlots: [],
		title: "示例问题",
		updatedAt: "2026-06-04T01:02:00.000Z",
	};
}

function createResponse(overrides: Partial<ToolExecutionResponse> = {}): ToolExecutionResponse {
	return {
		answerText: "国家奖学金每学年评审一次。",
		error: null,
		followUpQuestion: "",
		observability: null,
		result: null,
		selectedTool: "knowledge_query",
		status: "completed",
		traceId: "trace_accepted",
		...overrides,
	};
}

describe("buildFinalizedWrite trace integrity", () => {
	it("rejects finalization responses that drift from the accepted request trace", () => {
		expect(() =>
			buildFinalizedWrite({
				assistantMessageId: "msg_assistant_01HQ",
				branchId: "branch_active",
				completedAt: "2026-06-04T01:02:03.000Z",
				conversation: createConversation(),
				conversationTitle: "示例问题",
				durationMs: 3000,
				outboxEventId: "evt_final_01HQ",
				principal: createPrincipal(),
				requestId: "req_01HQ",
				requestedScope: null,
				requestedTool: "knowledge_query",
				response: createResponse({
					traceId: "trace_drifted",
				}),
				runId: "run_01HQ",
				safetyIdentifier: "safety_01HQ",
				startedAt: "2026-06-04T01:02:00.000Z",
				surface: "campus_web",
				traceId: "trace_accepted",
				turnSequence: 1,
				userMessageId: "msg_user_01HQ",
				versionQuery: null,
			}),
		).toThrowError(
			expect.objectContaining({
				code: "validation_failed",
				status: 422,
			}),
		);
	});
});
