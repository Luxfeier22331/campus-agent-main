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
	it("keeps the request identity on the finalized product response", async () => {
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

		expect(response.requestId).toBe("req_0001");
		expect(response.answer.result).toEqual({
			kind: "answer",
			requestId: "req_0001",
			text: "图书馆开放到 22:00。",
		});
		expect(response).not.toHaveProperty("traceId");
		expect(response.answer.result).not.toHaveProperty("traceId");
		expect(finalWrites[0]?.turnDispatch.requestId).toBe("req_0001");
		expect(finalWrites[0]?.requestObservabilityFact).not.toHaveProperty("traceId");
	});

	it("closes out by request identity despite clock skew and preserves replay conflicts", async () => {
		const { store, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const service = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-03-28T08:00:00.000Z"),
			conversationStore,
			store,
			executionRuntime: createExecutionRuntimeFromToolClient(
				{
					execute: vi.fn().mockResolvedValue({
						answerText: "图书馆开放到 22:00。",
						error: null,
						modelUsage: {
							cachedInputTokens: 10,
							inputTokens: 120,
							outputTokens: 42,
							totalTokens: 162,
						},
						result: {},
						status: "completed",
					}),
				},
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
		).rejects.toMatchObject({ code: "product_finalization_missing" });

		const response = {
			answerText: "图书馆开放到 22:00。",
			error: null,
			modelUsage: { cachedInputTokens: 10, inputTokens: 120, outputTokens: 42, totalTokens: 162 },
			result: {},
			status: "completed" as const,
		};
		await expect(
			service.applyProductFinalization?.({
				completedAt: "2026-03-28T07:59:59.000Z",
				finalizationFingerprint: "fingerprint-1",
				requestId: "req_0001",
				response,
			}),
		).resolves.toEqual({ outcome: "applied" });
		await expect(
			service.applyProductFinalization?.({
				completedAt: "2026-03-28T07:59:59.000Z",
				finalizationFingerprint: "fingerprint-1",
				requestId: "req_0001",
				response,
			}),
		).resolves.toEqual({ outcome: "replayed" });
		await expect(
			service.applyProductFinalization?.({
				completedAt: "2026-03-28T07:59:59.000Z",
				finalizationFingerprint: "fingerprint-1",
				requestId: "unknown",
				response,
			}),
		).rejects.toMatchObject({ code: "request_not_found" });
		await expect(
			service.applyProductFinalization?.({
				completedAt: "2026-03-28T07:59:59.000Z",
				finalizationFingerprint: "fingerprint-2",
				requestId: "req_0001",
				response,
			}),
		).rejects.toMatchObject({ name: "ChatFinalizationConflict" });
		expect(finalWrites).toHaveLength(1);
	});
}
