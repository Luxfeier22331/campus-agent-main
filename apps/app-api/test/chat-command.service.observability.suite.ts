import { expect, it, vi } from "vitest";

import {
	buildChatCommandService,
	createCommandStore,
	createConversationStore,
	createDeterministicIdGenerator,
	createPrincipal,
	createTelemetryMock,
} from "./chat-command.service.test-support";

export function registerChatCommandServiceObservabilitySuite(): void {
	it("maps clarification and no-answer statuses into chat-visible result kinds", async () => {
		const clarificationStore = createCommandStore();
		const noAnswerStore = createCommandStore();
		const clarificationConversationStore = createConversationStore();
		const noAnswerConversationStore = createConversationStore();
		const clarificationService = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-03-28T08:00:00.000Z"),
			conversationStore: clarificationConversationStore.store,
			store: clarificationStore.store,
			supervisor: {
				execute: vi.fn().mockResolvedValue({
					answerText: "",
					error: null,
					followUpQuestion: "你要问哪个校区？",
					result: null,
					selectedTarget: "rag-agent",
					status: "needs_clarification",
					traceId: "trace_0002",
				}),
			},
		});
		const noAnswerService = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-03-28T08:00:00.000Z"),
			conversationStore: noAnswerConversationStore.store,
			store: noAnswerStore.store,
			supervisor: {
				execute: vi.fn().mockResolvedValue({
					answerText: "当前没有足够依据回答这个问题。",
					error: null,
					followUpQuestion: "",
					result: null,
					selectedTarget: "rag-agent",
					status: "no_answer",
					traceId: "trace_0002",
				}),
			},
		});

		const clarification = await clarificationService.submit({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "开放时间？",
			},
			principal: createPrincipal(),
		});
		const noAnswer = await noAnswerService.submit({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "这个规定适用于所有学院吗？",
			},
			principal: createPrincipal(),
		});

		expect(clarification.answer.result).toEqual({
			kind: "clarification",
			requestId: "req_0001",
			text: "你要问哪个校区？",
			traceId: "trace_0002",
		});
		expect(clarificationStore.finalWrites[0]).toMatchObject({
			outboxEvent: {
				eventType: "request.needs_clarification",
			},
			requestExecution: {
				status: "needs_clarification",
			},
		});
		expect(noAnswer.answer.result).toEqual({
			kind: "no_answer",
			requestId: "req_0001",
			text: "当前没有足够依据回答这个问题。",
			traceId: "trace_0002",
		});
		expect(noAnswerStore.finalWrites[0]).toMatchObject({
			outboxEvent: {
				eventType: "request.no_answer",
			},
			requestExecution: {
				status: "no_answer",
			},
		});
	});

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

	it("writes request-scoped observability facts on accept and finalize", async () => {
		const { store, acceptedWrites, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const service = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-03-28T08:00:00.000Z"),
			conversationStore,
			store,
			supervisor: {
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
					selectedTarget: "rag-agent",
					status: "completed",
					traceId: "trace_0002",
				}),
			},
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
				modelName: null,
				modelProvider: null,
				outputTokens: null,
				policyProjectionVersion: "phase1-authorization-projection-v1",
				principalType: "student",
				requestId: "req_0001",
				requestedCapability: "knowledge",
				requestedScopeSummary: null,
				resolvedScopeSummary: null,
				retrievalAttempted: null,
				selectedTarget: null,
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
				modelName: "gpt-5.2-mini",
				modelProvider: "openai",
				outputTokens: 229,
				principalType: "student",
				requestId: "req_0001",
				requestedScopeSummary: null,
				resolvedScopeSummary: null,
				retrievedSourceCount: 2,
				retrievalAttempted: true,
				selectedTarget: "rag-agent",
				status: "completed",
				traceAvailable: true,
				traceId: "trace_0002",
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

	it("maps approval_required and rejected into chat-visible errors while preserving runtime statuses", async () => {
		const approvalStore = createCommandStore();
		const rejectedStore = createCommandStore();
		const approvalTelemetry = createTelemetryMock();
		const rejectedTelemetry = createTelemetryMock();
		const approvalService = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-03-28T08:00:00.000Z"),
			conversationStore: createConversationStore().store,
			store: approvalStore.store,
			supervisor: {
				execute: vi.fn().mockResolvedValue({
					answerText: "该请求涉及需要人工确认的操作，必须先经过审批。",
					error: null,
					followUpQuestion: "",
					result: null,
					selectedTarget: null,
					status: "approval_required",
					traceId: "trace_0002",
				}),
			},
			telemetry: approvalTelemetry,
		});
		const rejectedService = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-03-28T08:00:00.000Z"),
			conversationStore: createConversationStore().store,
			store: rejectedStore.store,
			supervisor: {
				execute: vi.fn().mockResolvedValue({
					answerText: "",
					error: {
						code: "request_rejected",
						message: "request was rejected by supervisor policy",
						retryable: false,
					},
					followUpQuestion: "",
					result: null,
					selectedTarget: null,
					status: "rejected",
					traceId: "trace_0002",
				}),
			},
			telemetry: rejectedTelemetry,
		});

		const approvalRequired = await approvalService.submit({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "帮我提交奖学金申请",
			},
			principal: createPrincipal(),
		});
		const rejected = await rejectedService.submit({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "直接替我发邮件给教务处",
			},
			principal: createPrincipal(),
		});

		expect(approvalRequired.answer.result).toEqual({
			errorCode: "approval_required",
			kind: "error",
			message: "该请求涉及需要人工确认的操作，必须先经过审批。",
			requestId: "req_0001",
			retryable: false,
			traceId: "trace_0002",
		});
		expect(approvalStore.finalWrites[0]).toMatchObject({
			outboxEvent: {
				eventType: "request.approval_required",
			},
			requestExecution: {
				selectedTarget: null,
				status: "approval_required",
			},
		});
		expect(approvalTelemetry.recordRequestFinalized).toHaveBeenCalledWith(
			expect.objectContaining({
				requestId: "req_0001",
				selectedTarget: null,
				status: "approval_required",
			}),
		);

		expect(rejected.answer.result).toEqual({
			errorCode: "request_rejected",
			kind: "error",
			message: "request was rejected by supervisor policy",
			requestId: "req_0001",
			retryable: false,
			traceId: "trace_0002",
		});
		expect(rejectedStore.finalWrites[0]).toMatchObject({
			outboxEvent: {
				eventType: "request.rejected",
			},
			requestExecution: {
				errorCode: "request_rejected",
				selectedTarget: null,
				status: "rejected",
			},
		});
		expect(rejectedTelemetry.recordRequestFinalized).toHaveBeenCalledWith(
			expect.objectContaining({
				requestId: "req_0001",
				selectedTarget: null,
				status: "rejected",
			}),
		);
	});
}
