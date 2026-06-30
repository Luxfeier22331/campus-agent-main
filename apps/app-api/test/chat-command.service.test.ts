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
				surface: "campus_web",
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

	it("carries prior RAG source proof into the next durable execution payload", async () => {
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
					evidence: {
						sources: [
							{
								chunk_id:
									"handbook:55f7:source-faithful:v1:d18cc0664629829168c0562e2b22c3982b35371e:chunk-0019",
								collection: "student_rules",
								doc_id: "handbook:55f7",
								snippet: "所评学年学习成绩排名与综合测评排名均位于前10%以内。",
								source_ref: "campus-agent://regulations/student_rules/docs/handbook:55f7",
								source_title: "中央民族大学本科学生国家奖学金评审办法",
								structural_ref:
									"span://handbook:55f7/handbook:55f7:source-faithful:v1:d18cc0664629829168c0562e2b22c3982b35371e:chunk-0019",
							},
						],
					},
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
			surface: "campus_web",
		});
		await service.submit({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "第二条具体是什么意思",
			},
			principal: createPrincipal(),
			surface: "campus_web",
		});

		const firstFinalWrite = finalWrites[0] as FinalizeRequestWrite | undefined;
		expect(firstFinalWrite?.assistantMessage.structuredParts).toEqual([
			{
				sourceItems: [
					expect.objectContaining({
						accessScope: "public",
						contentHash:
							"sha256:handbook:55f7:source-faithful:v1:d18cc0664629829168c0562e2b22c3982b35371e:chunk-0019",
						sourceId: "campus-agent://regulations/student_rules/docs/handbook:55f7",
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
		expect(conversationPayload?.previous_evidence_refs).toEqual([
			expect.objectContaining({
				access_scope: "public",
				content_hash:
					"sha256:handbook:55f7:source-faithful:v1:d18cc0664629829168c0562e2b22c3982b35371e:chunk-0019",
				document_id: "handbook:55f7",
				evidence_id:
					"handbook:55f7:source-faithful:v1:d18cc0664629829168c0562e2b22c3982b35371e:chunk-0019",
				source_id: "campus-agent://regulations/student_rules/docs/handbook:55f7",
				title: "中央民族大学本科学生国家奖学金评审办法",
				version_id:
					"span://handbook:55f7/handbook:55f7:source-faithful:v1:d18cc0664629829168c0562e2b22c3982b35371e:chunk-0019",
			}),
		]);
	});
});
