import { expect, it, vi } from "vitest";

import {
	buildChatCommandService,
	createCommandStore,
	createConversationStore,
	createDeterministicIdGenerator,
	createPrincipal,
} from "./chat-command.service.test-support";

export function registerChatCommandServiceObservabilityDiagnosticsSuite(): void {
	it("extracts summary diagnostics from rag results into runtime projection writes", async () => {
		const { store, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const service = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-03-28T08:00:00.000Z"),
			conversationStore,
			store,
			supervisor: {
				execute: vi.fn().mockResolvedValue({
					answerText:
						"在《中央民族大学本科学生国家奖学金评审办法》中，当前未检索到足够依据支持回答这个问题；请确认是否有更具体的条款表述。",
					error: null,
					followUpQuestion: "",
					result: {
						diagnostics: {
							clarification_reason: "",
							no_answer_reason: "resolved_policy_clause_not_found",
							resolved_policy_document_id: "handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15",
							resolved_policy_title: "中央民族大学本科学生国家奖学金评审办法",
							retrieved_title_summary: ["中央民族大学本科学生国家奖学金评审办法"],
							rewritten_query:
								"中央民族大学本科学生国家奖学金评审办法 民大评国奖不看第一作者单位吧，第一作者不是本校也能拿第二作者的分吧？",
						},
						evidence: {
							sources: [
								{
									doc_id: "handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15",
								},
							],
						},
					},
					selectedTarget: "rag-agent",
					status: "no_answer",
					traceId: "trace_0002",
				}),
			},
		});

		await service.submit({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "民大评国奖不看第一作者单位吧，第一作者不是本校也能拿第二作者的分吧？",
			},
			principal: createPrincipal(),
		});

		expect(finalWrites[0]).toMatchObject({
			outboxEvent: {
				payload: {
					diagnostics: {
						clarificationReason: null,
						noAnswerReason: "resolved_policy_clause_not_found",
						policyReason: null,
						resolvedPolicyDocumentId: "handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15",
						resolvedPolicyTitle: "中央民族大学本科学生国家奖学金评审办法",
						retrievedTitleSummary: ["中央民族大学本科学生国家奖学金评审办法"],
						rewrittenQuery:
							"中央民族大学本科学生国家奖学金评审办法 民大评国奖不看第一作者单位吧，第一作者不是本校也能拿第二作者的分吧？",
						scopeClass: null,
						semanticOutcome: null,
					},
				},
			},
			requestExecution: {
				diagnostics: {
					clarificationReason: null,
					noAnswerReason: "resolved_policy_clause_not_found",
					policyReason: null,
					resolvedPolicyDocumentId: "handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15",
					resolvedPolicyTitle: "中央民族大学本科学生国家奖学金评审办法",
					retrievedTitleSummary: ["中央民族大学本科学生国家奖学金评审办法"],
					rewrittenQuery:
						"中央民族大学本科学生国家奖学金评审办法 民大评国奖不看第一作者单位吧，第一作者不是本校也能拿第二作者的分吧？",
					scopeClass: null,
					semanticOutcome: null,
				},
			},
		});
	});

	it("keeps requested scope empty and records resolved curriculum scope when supervisor selects the serving surface", async () => {
		const { store, acceptedWrites, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const service = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-03-28T08:00:00.000Z"),
			conversationStore,
			store,
			supervisor: {
				execute: vi.fn().mockResolvedValue({
					answerText: "民族学本科人才培养方案总学分要求以培养方案正文为准。",
					error: null,
					followUpQuestion: "",
					observability: {
						aclAnomalyCode: null,
						aclDecision: "allowed",
						cachedInputTokens: 0,
						candidateCount: 1,
						citationCount: 1,
						citationExpected: true,
						citationMissing: false,
						estimatedCostMicrousd: 1234,
						failClosed: false,
						inputTokens: 256,
						modelName: "gpt-5.2-mini",
						modelProvider: "openai",
						outputTokens: 64,
						refusalClass: null,
						resolvedScopeCollection: "curriculum_plan",
						resolvedScopeCorpus: "curriculum",
						retrievedSourceCount: 1,
						retrievalAttempted: true,
					},
					result: {
						evidence: {
							sources: [{ doc_id: "curriculum:民族学本科人才培养方案" }],
						},
					},
					selectedTarget: "rag-agent",
					status: "completed",
					traceId: "trace_0002",
				}),
			},
		});

		await service.submit({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "民族学本科人才培养方案总学分要求是多少？",
			},
			principal: createPrincipal(),
		});

		expect(acceptedWrites[0]).toMatchObject({
			requestExecution: {
				requestedScope: null,
			},
			requestObservabilityFact: {
				collection: null,
				requestedScopeSummary: null,
				resolvedScopeSummary: null,
			},
		});
		expect(finalWrites[0]).toMatchObject({
			requestExecution: {
				requestedScope: null,
				resolvedScope: {
					collection: "curriculum_plan",
					corpus: "curriculum",
				},
			},
			requestObservabilityFact: {
				collection: "curriculum_plan",
				requestedScopeSummary: null,
				resolvedScopeSummary: "curriculum/curriculum_plan",
			},
		});
	});
}
