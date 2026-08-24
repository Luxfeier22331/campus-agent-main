import { expect, it, vi } from "vitest";

import {
	buildChatCommandService,
	createCommandStore,
	createConversationStore,
	createDeterministicIdGenerator,
	createExecutionRuntimeFromToolClient,
	createPrincipal,
} from "./chat-command.service.test-support";

export function registerChatCommandServiceCoreStructuredPart04Suite(): void {
	it("rejects finalized responses when execution omits the accepted traceId", async () => {
		const { store, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const invalidResponse = {
			answerText: "图书馆开放到 22:00。",
			error: null,
			modelUsage: { cachedInputTokens: 10, inputTokens: 120, outputTokens: 42, totalTokens: 162 },
			result: {
				evidence: {
					sources: [{ doc_id: "handbook:library-hours" }],
				},
			},
			status: "completed" as const,
			traceId: "",
		};
		const service = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-03-28T08:00:00.000Z"),
			conversationStore,
			store,
			executionRuntime: createExecutionRuntimeFromToolClient(
				{ execute: vi.fn().mockResolvedValue(invalidResponse) },
				{ skipProductCallback: true },
			),
		});

		await expect(
			service.submit({
				payload: {
					conversationId: "conv_01HQ",
					prompt: "图书馆开放到几点？",
				},
				principal: createPrincipal(),
				requestKind: "internal_eval",
			}),
		).rejects.toMatchObject({ code: "validation_failed", status: 422 });
		await expect(
			service.applyProductFinalization?.({
				completedAt: "2026-03-28T08:00:02.000Z",
				finalizationFingerprint: "trace-mismatch",
				response: invalidResponse,
				runId: "run_0001",
			}),
		).rejects.toMatchObject({ name: "ChatFinalizationConflict" });
		expect(finalWrites).toHaveLength(0);
	});

	it("keeps the accepted traceId on finalized responses when execution echoes it", async () => {
		const { store, finalWrites } = createCommandStore();
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
					modelUsage: {
						cachedInputTokens: 10,
						inputTokens: 120,
						outputTokens: 42,
						totalTokens: 162,
					},
					result: {
						evidence: {
							sources: [{ doc_id: "handbook:library-hours" }],
						},
					},
					status: "completed",
					traceId: "trace_0001",
				}),
			}),
		});

		const response = await service.submit({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "图书馆开放到几点？",
			},
			principal: createPrincipal(),
			requestKind: "internal_eval",
		});

		expect(response.traceId).toBe("trace_0001");
		expect(response.answer.result.traceId).toBe("trace_0001");
		expect(response.execution).toMatchObject({
			status: "completed",
			traceId: "trace_0001",
		});
		expect(finalWrites[0]).toMatchObject({
			requestObservabilityFact: {
				surface: "eval_benchmark",
				traceId: "trace_0001",
			},
		});
	});
}
