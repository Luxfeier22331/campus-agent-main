import { expect, it, vi } from "vitest";

import {
	buildChatCommandService,
	createCommandStore,
	createConversationStore,
	createDeterministicIdGenerator,
	createExecutionRuntimeFromToolClient,
	createPrincipal,
} from "./chat-command.service.test-support";

export function registerChatCommandServiceObservabilityRuntimeFactsSuite(): void {
	it("writes request-scoped observability facts on accept and finalize", async () => {
		const { store, acceptedWrites, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const service = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-03-28T08:00:00.000Z"),
			conversationStore,
			store,
			executionRuntime: createExecutionRuntimeFromToolClient({
				execute: vi.fn().mockResolvedValue({
					answerText: "图书馆开放到 22:00。",
					error: null,
					followUpQuestion: "",
					observability: {
						aclAnomalyCode: null,
						aclDecision: "allowed",
						cachedInputTokens: 0,
						candidateCount: 4,
						citationCount: 2,
						citationExpected: true,
						citationMissing: false,
						estimatedCostMicrousd: 3810,
						failClosed: false,
						inputTokens: 812,
						intentTool: "knowledge_query",
						intentClassifierVersion: "deterministic-intent-v1",
						intentLaunchState: "candidate_only",
						intentNextAction: "delegate",
						intentPolicyReason: null,
						intentScopeClass: "in_scope",
						intentScopeReason: "tool_read_model_runtime_candidate_signal",
						intentTaskKind: "knowledge_lookup",
						modelName: "gpt-5.2-mini",
						modelProvider: "openai",
						outputTokens: 229,
						refusalClass: null,
						retrievedSourceCount: 2,
						retrievalAttempted: true,
					},
					result: {
						evidence: {
							sources: [{ doc_id: "handbook:library-hours" }, { doc_id: "handbook:holiday-hours" }],
						},
					},
					selectedTool: "knowledge_query",
					status: "completed",
					traceId: "trace_0002",
				}),
			}),
		});

		await service.submit({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "图书馆开放到几点？",
			},
			principal: createPrincipal(),
		});

		expect(acceptedWrites[0]).toMatchObject({
			requestObservabilityFact: {
				aclAnomalyCode: null,
				aclDecision: null,
				candidateCount: null,
				citationCount: null,
				citationExpected: null,
				citationMissing: null,
				collection: null,
				conversationId: "conv_01HQ",
				emptyRecall: null,
				entitlementSnapshotId: "entitlements-2026-03-29",
				estimatedCostMicrousd: null,
				failClosed: null,
				inputTokens: null,
				intentTool: null,
				intentClassifierVersion: null,
				intentLaunchState: null,
				intentNextAction: null,
				intentPolicyReason: null,
				intentScopeClass: null,
				intentScopeReason: null,
				intentTaskKind: null,
				modelName: null,
				modelProvider: null,
				outputTokens: null,
				policyProjectionVersion: "phase1-authorization-projection-v1",
				principalType: "student",
				requestId: "req_0001",
				requestedTool: null,
				requestedScopeSummary: null,
				resolvedScopeSummary: null,
				retrievalAttempted: null,
				selectedTool: null,
				status: "accepted",
				traceAvailable: true,
				traceId: "trace_0001",
			},
		});
		expect(finalWrites[0]).toMatchObject({
			requestObservabilityFact: {
				aclAnomalyCode: null,
				aclDecision: "allowed",
				cachedInputTokens: 0,
				candidateCount: 4,
				citationCount: 2,
				citationExpected: true,
				citationMissing: false,
				collection: null,
				emptyRecall: false,
				estimatedCostMicrousd: 3810,
				failClosed: false,
				inputTokens: 812,
				intentTool: "knowledge_query",
				intentClassifierVersion: "deterministic-intent-v1",
				intentLaunchState: "candidate_only",
				intentNextAction: "delegate",
				intentPolicyReason: null,
				intentScopeClass: "in_scope",
				intentScopeReason: "tool_read_model_runtime_candidate_signal",
				intentTaskKind: "knowledge_lookup",
				modelName: "gpt-5.2-mini",
				modelProvider: "openai",
				outputTokens: 229,
				principalType: "student",
				requestId: "req_0001",
				requestedScopeSummary: null,
				resolvedScopeSummary: null,
				retrievedSourceCount: 2,
				retrievalAttempted: true,
				selectedTool: "knowledge_query",
				status: "completed",
				traceAvailable: true,
				traceId: "trace_0002",
			},
		});
	});
}
