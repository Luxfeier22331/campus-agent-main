import { expect, it, vi } from "vitest";

import {
	buildChatCommandService,
	createCommandStore,
	createConversationStore,
	createDeterministicIdGenerator,
	createExecutionRuntimeFromToolClient,
	createPrincipal,
} from "./chat-command.service.test-support";

export function registerChatCommandServiceObservabilityStatusSuite(): void {
	it("persists follow-up questions and insufficient-evidence replies as completed answers", async () => {
		const followUpStore = createCommandStore();
		const insufficientEvidenceStore = createCommandStore();
		const followUpService = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-03-28T08:00:00.000Z"),
			conversationStore: createConversationStore().store,
			store: followUpStore.store,
			executionRuntime: createExecutionRuntimeFromToolClient({
				execute: vi.fn().mockResolvedValue({
					answerText: "你要问哪个校区？",
					error: null,
					modelUsage: {
						cachedInputTokens: 10,
						inputTokens: 120,
						outputTokens: 42,
						totalTokens: 162,
					},
					result: null,
					status: "completed",
				}),
			}),
		});
		const insufficientEvidenceService = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-03-28T08:00:00.000Z"),
			conversationStore: createConversationStore().store,
			store: insufficientEvidenceStore.store,
			executionRuntime: createExecutionRuntimeFromToolClient({
				execute: vi.fn().mockResolvedValue({
					answerText: "当前没有足够依据回答这个问题。",
					error: null,
					modelUsage: {
						cachedInputTokens: 10,
						inputTokens: 120,
						outputTokens: 42,
						totalTokens: 162,
					},
					result: null,
					status: "completed",
				}),
			}),
		});

		const followUp = await followUpService.submit({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "开放时间？",
			},
			principal: createPrincipal(),
		});
		const insufficientEvidence = await insufficientEvidenceService.submit({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "这个规定适用于所有学院吗？",
			},
			principal: createPrincipal(),
		});

		expect(followUp.answer.result).toEqual({
			kind: "answer",
			requestId: "req_0001",
			text: "你要问哪个校区？",
		});
		expect(followUpStore.finalWrites[0]).toMatchObject({
			turnDispatch: {
				status: "completed",
			},
		});
		expect(insufficientEvidence.answer.result).toEqual({
			kind: "answer",
			requestId: "req_0001",
			text: "当前没有足够依据回答这个问题。",
		});
		expect(insufficientEvidenceStore.finalWrites[0]).toMatchObject({
			turnDispatch: {
				status: "completed",
			},
		});
	});

	it("passes through public informational limits as answer text", async () => {
		const followUpStore = createCommandStore();
		const insufficientEvidenceStore = createCommandStore();
		const approvalStore = createCommandStore();
		const rejectedStore = createCommandStore();
		const followUpService = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-04-27T09:00:00.000Z"),
			conversationStore: createConversationStore().store,
			store: followUpStore.store,
			executionRuntime: createExecutionRuntimeFromToolClient({
				execute: vi.fn().mockResolvedValue({
					answerText: "请说明学生规定方向。当前可查询：缓考申请、转专业申请。",
					error: null,
					modelUsage: {
						cachedInputTokens: 10,
						inputTokens: 120,
						outputTokens: 42,
						totalTokens: 162,
					},
					result: {
						tool_result: {
							candidate_routes: [{ display_name: "缓考申请" }, { display_name: "转专业申请" }],
						},
					},
					status: "completed",
				}),
			}),
		});
		const insufficientEvidenceService = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-04-27T09:00:00.000Z"),
			conversationStore: createConversationStore().store,
			store: insufficientEvidenceStore.store,
			executionRuntime: createExecutionRuntimeFromToolClient({
				execute: vi.fn().mockResolvedValue({
					answerText: "为避免误导，当前来源信息存在冲突，暂时无法确认学生规定临时变更。",
					error: null,
					modelUsage: {
						cachedInputTokens: 10,
						inputTokens: 120,
						outputTokens: 42,
						totalTokens: 162,
					},
					result: {
						tool_result: {
							fail_close_reason: "source_conflict",
							outcome: "temporarily_unverifiable",
							query_text: "学生规定临时变更",
						},
					},
					status: "completed",
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
					modelUsage: {
						cachedInputTokens: 10,
						inputTokens: 120,
						outputTokens: 42,
						totalTokens: 162,
					},
					result: {
						tool_result: {
							outcome: "resolved_current",
							query_text: "地铁校内规定预约",
						},
					},
					status: "approval_required",
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
					modelUsage: {
						cachedInputTokens: 10,
						inputTokens: 120,
						outputTokens: 42,
						totalTokens: 162,
					},
					result: {
						tool_result: {
							outcome: "resolved_current",
							query_text: "招生办电话",
						},
					},
					status: "rejected",
				}),
			}),
		});

		const followUp = await followUpService.submit({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "学生规定最早几点发车",
			},
			principal: createPrincipal(),
		});
		const insufficientEvidence = await insufficientEvidenceService.submit({
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

		expect(followUp.answer.result.kind).toBe("answer");
		if (followUp.answer.result.kind !== "answer") {
			throw new Error("expected answer result");
		}
		expect(followUp.answer.result.text).toContain("请说明学生规定方向");
		expect(followUp.answer.result.text).toContain("缓考申请");
		expect(followUpStore.finalWrites[0]).toMatchObject({
			turnDispatch: {
				status: "completed",
			},
		});

		expect(insufficientEvidence.answer.result.kind).toBe("answer");
		if (insufficientEvidence.answer.result.kind !== "answer") {
			throw new Error("expected answer result");
		}
		expect(insufficientEvidence.answer.result.text).toContain("为避免误导");
		expect(insufficientEvidence.answer.result.text).toContain("来源信息存在冲突");
		expect(insufficientEvidence.answer.result.text).toContain("学生规定临时变更");
		expect(insufficientEvidenceStore.finalWrites[0]).toMatchObject({
			turnDispatch: {
				status: "completed",
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
		const approvalService = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-03-28T08:00:00.000Z"),
			conversationStore: createConversationStore().store,
			store: approvalStore.store,
			executionRuntime: createExecutionRuntimeFromToolClient({
				execute: vi.fn().mockResolvedValue({
					answerText: "该请求涉及需要人工确认的操作，必须先经过审批。",
					error: null,
					modelUsage: {
						cachedInputTokens: 10,
						inputTokens: 120,
						outputTokens: 42,
						totalTokens: 162,
					},
					result: null,
					status: "approval_required",
				}),
			}),
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
					modelUsage: {
						cachedInputTokens: 10,
						inputTokens: 120,
						outputTokens: 42,
						totalTokens: 162,
					},
					result: null,
					status: "rejected",
				}),
			}),
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
		});
		expect(approvalStore.finalWrites[0]).toMatchObject({
			turnDispatch: {
				status: "approval_required",
			},
		});
		expect(rejected.answer.result).toEqual({
			errorCode: "request_rejected",
			kind: "error",
			message: "The request was rejected by execution policy.",
			requestId: "req_0001",
			retryable: false,
		});
		expect(rejectedStore.finalWrites[0]).toMatchObject({
			turnDispatch: {
				errorCode: "request_rejected",
				status: "rejected",
			},
		});
	});
}
