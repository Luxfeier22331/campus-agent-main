// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { registerChatCommandServiceCoreSuite } from "./chat-command.service.core.suite";
import { registerChatCommandServiceCurriculumSuite } from "./chat-command.service.curriculum.suite";
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
} from "./chat-command.service.test-support";

describe("chat command service", () => {
	registerChatCommandServiceCoreSuite();
	registerChatCommandServiceObservabilitySuite();
	registerChatCommandServiceIdempotencySuite();
	registerChatCommandServiceCurriculumSuite();

	it("fails closed instead of using a legacy direct execution path", async () => {
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
		expect(acceptedWrites).toHaveLength(1);
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
				followUpQuestion: "",
				result: {
					sources: [
						{
							canonical_url: "/docs/regulations/student_rules/scholarship",
							snippet: "所评学年学习成绩排名与综合测评排名均位于前10%以内。",
							source_kind: "regulation",
							source_title: "示例大学本科学生国家奖学金评审办法",
							target_kind: "canonical_reader",
							version_id: "student-rules-current",
						},
					],
				},
				selectedTool: "knowledge_query",
				status: "completed",
				traceId: "trace_0001",
			})
			.mockResolvedValueOnce({
				answerText: "第二条指单科成绩不能低于80分。",
				error: null,
				followUpQuestion: "",
				result: {},
				selectedTool: null,
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
						primaryAction: expect.objectContaining({
							href: "/docs/regulations/student_rules/scholarship",
						}),
						title: "示例大学本科学生国家奖学金评审办法",
						versionId: "student-rules-current",
					}),
				],
				type: "source_items",
			},
		]);
		const secondCreateRunInput = vi.mocked(executionRuntime.createRun).mock.calls[1]?.[0];
		const executionPayload = secondCreateRunInput?.metadata.execution_payload as
			| Record<string, unknown>
			| undefined;
		const context = executionPayload?.context as Record<string, unknown> | undefined;
		const conversationPayload = context?.conversation as Record<string, unknown> | undefined;
		expect(conversationPayload?.previous_evidence_refs).toEqual([]);
	});
});
