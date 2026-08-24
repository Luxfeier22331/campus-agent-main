// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { registerChatCommandServiceCoreSuite } from "./chat-command.service.core.suite";
import { registerChatCommandServiceIdempotencySuite } from "./chat-command.service.idempotency.suite";
import { registerChatCommandServiceObservabilitySuite } from "./chat-command.service.observability.suite";
import {
	buildChatCommandService,
	createCommandStore,
	createConversation,
	createConversationStore,
	createDeterministicIdGenerator,
	createExecutionRuntimeFromToolClient,
	createPrincipal,
	type FinalizeRequestWrite,
	getFrozenExecutionPayload,
} from "./chat-command.service.test-support";

describe("chat command service", () => {
	registerChatCommandServiceCoreSuite();
	registerChatCommandServiceObservabilitySuite();
	registerChatCommandServiceIdempotencySuite();

	it("fails before accept instead of creating an unrecoverable turn without durable runtime", async () => {
		const { store, acceptedWrites, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const legacyExecutionClient = {
			execute: vi.fn(),
			executeStream: vi.fn(),
		};
		const service = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-06-06T00:00:00.000Z"),
			conversationStore,
			store,
		});

		await expect(
			service.submit({
				payload: {
					conversationId: "conv_01HQ",
					prompt: "图书馆开放到几点？",
				},
				principal: createPrincipal(),
				requestKind: "public_chat",
			}),
		).rejects.toMatchObject({
			code: "execution_runtime_required",
			retryable: true,
			status: 503,
		});
		expect(legacyExecutionClient.execute).not.toHaveBeenCalled();
		expect(legacyExecutionClient.executeStream).not.toHaveBeenCalled();
		expect(acceptedWrites).toHaveLength(0);
		expect(finalWrites).toHaveLength(0);
	});

	it("does not turn finalized public sources back into internal evidence locators", async () => {
		const sharedConversation = createConversation();
		const { finalWrites, store } = createCommandStore({ conversation: sharedConversation });
		const { store: conversationStore } = createConversationStore({
			conversation: sharedConversation,
		});
		const execute = vi
			.fn()
			.mockResolvedValueOnce({
				answerText: "国家奖学金要求学习成绩排名和综合测评排名均在前10%。",
				error: null,
				modelUsage: { cachedInputTokens: 10, inputTokens: 120, outputTokens: 42, totalTokens: 162 },
				result: {
					sources: [
						{
							citation_index: 1,
							document_id: "student_rules/scholarship",
							kind: "campus_document",
							root_unit_ids: ["scholarship-eligibility"],
							section_ref: "/docs/regulations/student_rules/scholarship/v/2026-current#eligibility",
							section_title: "申请条件",
							snippet: "所评学年学习成绩排名与综合测评排名均位于前10%以内。",
							title: "示例大学本科学生国家奖学金评审办法",
							version_id: "version-scholarship-2026",
							version_label: "2026 版",
							version_slug: "2026-current",
						},
					],
				},
				status: "completed",
				traceId: "trace_0001",
			})
			.mockResolvedValueOnce({
				answerText: "第二条指单科成绩不能低于80分。",
				error: null,
				modelUsage: { cachedInputTokens: 10, inputTokens: 120, outputTokens: 42, totalTokens: 162 },
				result: {},
				status: "completed",
				traceId: "trace_0002",
			});
		const executionRuntime = createExecutionRuntimeFromToolClient({ execute });
		const service = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-04-27T09:00:00.000Z"),
			conversationStore,
			store,
			executionRuntime,
		});

		await service.submit({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "国家奖学金申请条件是什么",
			},
			principal: createPrincipal(),
			requestKind: "public_chat",
		});
		await service.submit({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "第二条具体是什么意思",
			},
			principal: createPrincipal(),
			requestKind: "public_chat",
		});

		const firstFinalWrite = finalWrites[0] as FinalizeRequestWrite | undefined;
		expect(firstFinalWrite?.assistantMessage.structuredParts).toEqual([
			{
				sourceItems: [
					expect.objectContaining({
						kind: "campus_document",
						primaryAction: expect.objectContaining({
							href: "/docs/regulations/student_rules/scholarship/v/2026-current?hl=scholarship-eligibility#eligibility",
						}),
						title: "示例大学本科学生国家奖学金评审办法",
					}),
				],
				type: "source_items",
			},
		]);
		const secondCreateRunInput = vi.mocked(executionRuntime.createRun).mock.calls[1]?.[0];
		const executionPayload = getFrozenExecutionPayload(secondCreateRunInput?.runId ?? "run_0002");
		const context = executionPayload.context as Record<string, unknown>;
		const conversationPayload = context.conversation as Record<string, unknown>;
		expect(conversationPayload).not.toHaveProperty("previous_evidence_refs");
		expect(conversationPayload).not.toHaveProperty("previous_tool_results");
	});
});
