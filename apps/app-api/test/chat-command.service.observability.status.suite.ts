import { expect, it, vi } from "vitest";

import {
	buildChatCommandService,
	createCommandStore,
	createConversationStore,
	createDeterministicIdGenerator,
	createExecutionRuntimeFromToolClient,
	createPrincipal,
	createTelemetryMock,
	expectNoInternalLocators,
} from "./chat-command.service.test-support";

export function registerChatCommandServiceObservabilityStatusSuite(): void {
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
			executionRuntime: createExecutionRuntimeFromToolClient({
				execute: vi.fn().mockResolvedValue({
					answerText: "",
					error: null,
					followUpQuestion: "你要问哪个校区？",
					modelUsage: {
						cachedInputTokens: 10,
						inputTokens: 120,
						outputTokens: 42,
						totalTokens: 162,
					},
					result: null,
					status: "needs_clarification",
					traceId: "trace_0001",
				}),
			}),
		});
		const noAnswerService = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-03-28T08:00:00.000Z"),
			conversationStore: noAnswerConversationStore.store,
			store: noAnswerStore.store,
			executionRuntime: createExecutionRuntimeFromToolClient({
				execute: vi.fn().mockResolvedValue({
					answerText: "当前没有足够依据回答这个问题。",
					error: null,
					followUpQuestion: "",
					modelUsage: {
						cachedInputTokens: 10,
						inputTokens: 120,
						outputTokens: 42,
						totalTokens: 162,
					},
					result: null,
					status: "no_answer",
					traceId: "trace_0001",
				}),
			}),
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
			traceId: "trace_0001",
		});
		expect(clarificationStore.finalWrites[0]).toMatchObject({
			turnDispatch: {
				status: "needs_clarification",
			},
		});
		expect(noAnswer.answer.result).toEqual({
			kind: "no_answer",
			requestId: "req_0001",
			text: "当前没有足够依据回答这个问题。",
			traceId: "trace_0001",
		});
		expect(noAnswerStore.finalWrites[0]).toMatchObject({
			turnDispatch: {
				status: "no_answer",
			},
		});
	});

	it("passes through public guardrail text for clarification, fail-close, and no-action statuses", async () => {
		const clarificationStore = createCommandStore();
		const noAnswerStore = createCommandStore();
		const approvalStore = createCommandStore();
		const rejectedStore = createCommandStore();
		const clarificationService = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-04-27T09:00:00.000Z"),
			conversationStore: createConversationStore().store,
			store: clarificationStore.store,
			executionRuntime: createExecutionRuntimeFromToolClient({
				execute: vi.fn().mockResolvedValue({
					answerText: "请说明学生规定方向。当前可查询：缓考申请、转专业申请。",
					error: null,
					followUpQuestion: "",
					modelUsage: {
						cachedInputTokens: 10,
						inputTokens: 120,
						outputTokens: 42,
						totalTokens: 162,
					},
					result: {
						payload_kind: "knowledge_query",
						tool_result: {
							candidate_routes: [{ display_name: "缓考申请" }, { display_name: "转专业申请" }],
							clarification_reason: "route_direction_required",
							outcome: "clarification_required",
						},
					},
					status: "needs_clarification",
					traceId: "trace_0001",
				}),
			}),
		});
		const noAnswerService = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-04-27T09:00:00.000Z"),
			conversationStore: createConversationStore().store,
			store: noAnswerStore.store,
			executionRuntime: createExecutionRuntimeFromToolClient({
				execute: vi.fn().mockResolvedValue({
					answerText: "为避免误导，当前来源信息存在冲突，暂时无法确认学生规定临时变更。",
					error: null,
					followUpQuestion: "",
					modelUsage: {
						cachedInputTokens: 10,
						inputTokens: 120,
						outputTokens: 42,
						totalTokens: 162,
					},
					result: {
						payload_kind: "knowledge_query",
						tool_result: {
							fail_close_reason: "source_conflict",
							outcome: "temporarily_unverifiable",
							query_text: "学生规定临时变更",
						},
					},
					status: "no_answer",
					traceId: "trace_0001",
				}),
			}),
		});
		const approvalService = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-04-27T09:00:00.000Z"),
			conversationStore: createConversationStore().store,
			store: approvalStore.store,
			executionRuntime: createExecutionRuntimeFromToolClient({
				execute: vi.fn().mockResolvedValue({
					answerText:
						"不能代你预约、提交、打电话或发邮件；如需继续，请先进入对应官方入口完成人工确认。",
					error: null,
					followUpQuestion: "",
					modelUsage: {
						cachedInputTokens: 10,
						inputTokens: 120,
						outputTokens: 42,
						totalTokens: 162,
					},
					result: {
						payload_kind: "knowledge_query",
						tool_result: {
							outcome: "resolved_current",
							query_text: "地铁校内规定预约",
						},
					},
					status: "approval_required",
					traceId: "trace_0001",
				}),
			}),
		});
		const rejectedService = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-04-27T09:00:00.000Z"),
			conversationStore: createConversationStore().store,
			store: rejectedStore.store,
			executionRuntime: createExecutionRuntimeFromToolClient({
				execute: vi.fn().mockResolvedValue({
					answerText: "",
					error: {
						code: "request_rejected",
						message: "不能代你预约、提交、打电话或发邮件；当前请求已被策略拒绝。",
						retryable: false,
					},
					followUpQuestion: "",
					modelUsage: {
						cachedInputTokens: 10,
						inputTokens: 120,
						outputTokens: 42,
						totalTokens: 162,
					},
					result: {
						payload_kind: "knowledge_query",
						tool_result: {
							outcome: "resolved_current",
							query_text: "招生办电话",
						},
					},
					status: "rejected",
					traceId: "trace_0001",
				}),
			}),
		});

		const clarification = await clarificationService.submit({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "学生规定最早几点发车",
			},
			principal: createPrincipal(),
		});
		const noAnswer = await noAnswerService.submit({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "学生规定临时变更",
			},
			principal: createPrincipal(),
		});
		const approval = await approvalService.submit({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "帮我预约地铁校内规定",
			},
			principal: createPrincipal(),
		});
		const rejected = await rejectedService.submit({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "帮我给招生办发邮件",
			},
			principal: createPrincipal(),
		});

		expect(clarification.answer.result.kind).toBe("clarification");
		if (clarification.answer.result.kind !== "clarification") {
			throw new Error("expected clarification result");
		}
		expect(clarification.answer.result.text).toContain("请说明学生规定方向");
		expect(clarification.answer.result.text).toContain("缓考申请");
		expectNoInternalLocators(clarification.answer.result.text);
		expect(clarificationStore.finalWrites[0]).toMatchObject({
			turnDispatch: {
				status: "needs_clarification",
			},
		});

		expect(noAnswer.answer.result.kind).toBe("no_answer");
		if (noAnswer.answer.result.kind !== "no_answer") {
			throw new Error("expected no_answer result");
		}
		expect(noAnswer.answer.result.text).toContain("为避免误导");
		expect(noAnswer.answer.result.text).toContain("来源信息存在冲突");
		expect(noAnswer.answer.result.text).toContain("学生规定临时变更");
		expectNoInternalLocators(noAnswer.answer.result.text);
		expect(noAnswerStore.finalWrites[0]).toMatchObject({
			turnDispatch: {
				status: "no_answer",
			},
		});

		expect(approval.answer.result.kind).toBe("error");
		if (approval.answer.result.kind !== "error") {
			throw new Error("expected error result");
		}
		expect(approval.answer.result.message).toBe(
			"The request requires approval before it can continue.",
		);
		expect(approvalStore.finalWrites[0]).toMatchObject({
			turnDispatch: {
				status: "approval_required",
			},
		});

		expect(rejected.answer.result.kind).toBe("error");
		if (rejected.answer.result.kind !== "error") {
			throw new Error("expected error result");
		}
		expect(rejected.answer.result.message).toBe("The request was rejected by execution policy.");
		expect(rejectedStore.finalWrites[0]).toMatchObject({
			turnDispatch: {
				errorCode: "request_rejected",
				status: "rejected",
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
			executionRuntime: createExecutionRuntimeFromToolClient({
				execute: vi.fn().mockResolvedValue({
					answerText: "该请求涉及需要人工确认的操作，必须先经过审批。",
					error: null,
					followUpQuestion: "",
					modelUsage: {
						cachedInputTokens: 10,
						inputTokens: 120,
						outputTokens: 42,
						totalTokens: 162,
					},
					result: null,
					status: "approval_required",
					traceId: "trace_0001",
				}),
			}),
			telemetry: approvalTelemetry,
		});
		const rejectedService = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-03-28T08:00:00.000Z"),
			conversationStore: createConversationStore().store,
			store: rejectedStore.store,
			executionRuntime: createExecutionRuntimeFromToolClient({
				execute: vi.fn().mockResolvedValue({
					answerText: "",
					error: {
						code: "request_rejected",
						message: "postgres://user:secret@internal-db/runtime",
						retryable: false,
					},
					followUpQuestion: "",
					modelUsage: {
						cachedInputTokens: 10,
						inputTokens: 120,
						outputTokens: 42,
						totalTokens: 162,
					},
					result: null,
					status: "rejected",
					traceId: "trace_0001",
				}),
			}),
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
			message: "The request requires approval before it can continue.",
			requestId: "req_0001",
			retryable: false,
			traceId: "trace_0001",
		});
		expect(approvalStore.finalWrites[0]).toMatchObject({
			turnDispatch: {
				status: "approval_required",
			},
		});
		expect(approvalTelemetry.configureRequestOutcome).toHaveBeenCalledWith(
			expect.objectContaining({
				requestId: "req_0001",
				status: "approval_required",
			}),
		);
		expect(rejected.answer.result).toEqual({
			errorCode: "request_rejected",
			kind: "error",
			message: "The request was rejected by execution policy.",
			requestId: "req_0001",
			retryable: false,
			traceId: "trace_0001",
		});
		expect(rejectedStore.finalWrites[0]).toMatchObject({
			turnDispatch: {
				errorCode: "request_rejected",
				status: "rejected",
			},
		});
		expect(rejectedTelemetry.configureRequestOutcome).toHaveBeenCalledWith(
			expect.objectContaining({
				requestId: "req_0001",
				status: "rejected",
			}),
		);
	});
}
