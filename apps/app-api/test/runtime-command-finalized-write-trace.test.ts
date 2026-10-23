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
		observability: null,
		result: null,
		status: "completed",
		...overrides,
		modelUsage: overrides.modelUsage ?? {
			cachedInputTokens: 10,
			inputTokens: 120,
			outputTokens: 42,
			totalTokens: 162,
		},
	};
}

describe("buildFinalizedWrite request identity", () => {
	it("builds the final write from the accepted request identity", () => {
		const result = buildFinalizedWrite({
			assistantMessageId: "msg_assistant_01HQ",
			branchId: "branch_active",
			completedAt: "2026-06-04T01:02:03.000Z",
			conversation: createConversation(),
			conversationTitle: "示例问题",
			durationMs: 3000,
			principal: createPrincipal(),
			requestId: "req_01HQ",
			response: createResponse({}),
			safetyIdentifier: "safety_01HQ",
			startedAt: "2026-06-04T01:02:00.000Z",
			surface: "campus_web",
			turnSequence: 1,
			userMessageId: "msg_user_01HQ",
		});
		expect(result).toMatchObject({
			responseBody: {
				requestId: "req_01HQ",
				answer: { result: { requestId: "req_01HQ" } },
			},
			write: {
				turnDispatch: { requestId: "req_01HQ" },
			},
		});
	});
});
