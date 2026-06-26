// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
	buildChatCommandService,
	type CapabilityExecutionClient,
	createCommandStore,
	createConversationStore,
	createDeterministicIdGenerator,
	createExecutionRuntimeFromCapabilityClient,
	createPrincipal,
	createTelemetryMock,
} from "./chat-command.service.test-support";

function createCompletedExecutionClient(): CapabilityExecutionClient {
	return {
		execute: vi.fn().mockResolvedValue({
			answerText: "可以，先看培养方案和学院通知。",
			error: null,
			followUpQuestion: "",
			result: {},
			selectedCapability: "knowledge",
			status: "completed",
			traceId: "trace_0002",
		}),
	};
}

describe("chat command service memory gate projection", () => {
	it("projects only profile memory enabled summary for execution memory update gate", async () => {
		const { store } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const profileMemoryStore = {
			loadSummary: vi.fn().mockResolvedValue({
				enabled: false,
				itemCount: 3,
			}),
		};
		const executionClient = createCompletedExecutionClient();

		const service = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-04-27T08:00:00.000Z"),
			conversationStore,
			store,
			executionRuntime: createExecutionRuntimeFromCapabilityClient(executionClient),
			profileMemoryStore,
		});

		await service.submit({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "我之后主要关注保研材料",
				requestedCapability: "knowledge",
			},
			principal: createPrincipal(),
			surface: "campus_web",
		});

		expect(profileMemoryStore.loadSummary).toHaveBeenCalledWith({
			ownerUserId: "user_01HQ",
		});
		expect(executionClient.execute).toHaveBeenCalledWith(
			expect.objectContaining({
				context: expect.objectContaining({
					memory: {
						enabled: false,
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

	it("omits memory gate when profile memory summary cannot be loaded", async () => {
		const { store } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const telemetry = createTelemetryMock();
		const profileMemoryStore = {
			loadSummary: vi.fn().mockRejectedValue(new Error("profile memory unavailable")),
		};
		const executionClient = createCompletedExecutionClient();

		const service = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-04-27T08:00:00.000Z"),
			conversationStore,
			store,
			executionRuntime: createExecutionRuntimeFromCapabilityClient(executionClient),
			profileMemoryStore,
			telemetry,
		});

		await service.submit({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "我之后主要关注保研材料",
				requestedCapability: "knowledge",
			},
			principal: createPrincipal(),
			surface: "campus_web",
		});

		expect(telemetry.captureException).toHaveBeenCalledWith(
			expect.any(Error),
			expect.objectContaining({
				route: "/api/chat/requests",
				surface: "campus_web",
				traceId: "trace_0001",
			}),
		);
		expect(executionClient.execute).toHaveBeenCalledWith(
			expect.objectContaining({
				context: expect.not.objectContaining({
					memory: expect.anything(),
				}),
			}),
		);
	});
});
