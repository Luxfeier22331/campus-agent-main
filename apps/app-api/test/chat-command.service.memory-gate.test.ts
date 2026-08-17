// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
	buildChatCommandService,
	createCommandStore,
	createConversationStore,
	createDeterministicIdGenerator,
	createExecutionRuntimeFromToolClient,
	createPrincipal,
	type ToolExecutionClient,
} from "./chat-command.service.test-support";

function createCompletedExecutionClient(): ToolExecutionClient {
	return {
		execute: vi.fn().mockResolvedValue({
			answerText: "可以，先看培养方案和学院通知。",
			error: null,
			followUpQuestion: "",
			modelUsage: { cachedInputTokens: 10, inputTokens: 120, outputTokens: 42, totalTokens: 162 },
			result: {},
			status: "completed",
			traceId: "trace_0001",
		}),
	};
}

describe("chat command service memory gate projection", () => {
	it("projects the immutable memory snapshot returned by accept", async () => {
		const { acceptedWrites, frozenAdmissionMemorySnapshots, store } = createCommandStore({
			memorySnapshot: {
				appendEnabled: true,
				ownerGeneration: 3,
				ownerSequence: 7,
				recallEnabled: false,
			},
		});
		const { store: conversationStore } = createConversationStore();
		const executionClient = createCompletedExecutionClient();

		const service = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-04-27T08:00:00.000Z"),
			conversationStore,
			captureProfileMemorySnapshot: true,
			store,
			executionRuntime: createExecutionRuntimeFromToolClient(executionClient),
		});

		await service.submit({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "我之后主要关注保研材料",
			},
			principal: createPrincipal(),
			requestKind: "public_chat",
		});
		expect(frozenAdmissionMemorySnapshots).toEqual([
			{
				appendEnabled: true,
				ownerGeneration: 3,
				ownerSequence: 7,
				recallEnabled: false,
			},
		]);
		expect(acceptedWrites[0]?.captureMemorySnapshot).toBe(true);

		expect(executionClient.execute).toHaveBeenCalledWith(
			expect.objectContaining({
				context: expect.objectContaining({
					memory: {
						appendEnabled: true,
						ownerGeneration: 3,
						ownerSequence: 7,
						recallEnabled: false,
					},
				}),
				tenantId: "tenant-main",
			}),
		);
		expect(executionClient.execute).toHaveBeenCalledWith(
			expect.objectContaining({
				context: expect.not.objectContaining({
					profileMemory: expect.anything(),
				}),
			}),
		);
	});

	it("omits memory when accept returns no configured snapshot", async () => {
		const { store } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const executionClient = createCompletedExecutionClient();

		const service = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-04-27T08:00:00.000Z"),
			conversationStore,
			store,
			executionRuntime: createExecutionRuntimeFromToolClient(executionClient),
		});

		await service.submit({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "我之后主要关注保研材料",
			},
			principal: createPrincipal(),
			requestKind: "public_chat",
		});

		expect(executionClient.execute).toHaveBeenCalledWith(
			expect.objectContaining({
				context: expect.not.objectContaining({
					memory: expect.anything(),
				}),
			}),
		);
	});
});
