import { expect, it, vi } from "vitest";

import {
	buildChatCommandService,
	createCommandStore,
	createConversationStore,
	createDeterministicIdGenerator,
	createExecutionRuntimeFromCapabilityClient,
	createPrincipal,
	createTelemetryMock,
} from "./chat-command.service.test-support";

export function registerChatCommandServiceObservabilityTraceBacklinksSuite(): void {
	it("records operator trace backlinks during the request lifecycle without blocking answers", async () => {
		const { store } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const telemetry = createTelemetryMock();
		const traceBacklinkRecorder = {
			record: vi
				.fn()
				.mockRejectedValueOnce(new Error("backlink sink unavailable"))
				.mockResolvedValue(undefined),
		};
		const service = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-03-28T08:00:00.000Z"),
			conversationStore,
			store,
			executionRuntime: createExecutionRuntimeFromCapabilityClient({
				execute: vi.fn().mockResolvedValue({
					answerText: "",
					error: {
						code: "execution_control_timeout",
						message: "execution control timed out",
						retryable: true,
					},
					followUpQuestion: "",
					result: null,
					selectedCapability: "knowledge",
					status: "error",
					traceId: "trace_0002",
				}),
			}),
			telemetry,
			traceBacklinkRecorder,
		});

		const response = await service.submit({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "图书馆开放到几点？",
			},
			principal: createPrincipal(),
		});

		expect(response.answer.result).toMatchObject({
			errorCode: "execution_control_timeout",
			kind: "error",
			requestId: "req_0001",
			traceId: "trace_0002",
		});
		expect(traceBacklinkRecorder.record).toHaveBeenCalledTimes(1);
		expect(traceBacklinkRecorder.record).toHaveBeenCalledWith({
			errorCode: "execution_control_timeout",
			requestId: "req_0001",
			selectedCapability: "knowledge",
			status: "error",
			surface: "campus_web",
			traceId: "trace_0002",
		});
		expect(telemetry.captureException).toHaveBeenCalledWith(
			expect.any(Error),
			expect.objectContaining({
				route: "/api/chat/requests",
				surface: "campus_web",
				traceId: "trace_0002",
			}),
		);
	});

	it("defers operator trace backlink writes through request waitUntil when available", async () => {
		const { store } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const waitUntil = vi.fn();
		const traceBacklinkRecorder = {
			record: vi.fn().mockReturnValue(new Promise<void>((_resolve) => undefined)),
		};
		const service = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-03-28T08:00:00.000Z"),
			conversationStore,
			store,
			executionRuntime: createExecutionRuntimeFromCapabilityClient({
				execute: vi.fn().mockResolvedValue({
					answerText: "图书馆开放到 22:00。",
					error: null,
					followUpQuestion: "",
					result: null,
					selectedCapability: "knowledge",
					status: "completed",
					traceId: "trace_0002",
				}),
			}),
			traceBacklinkRecorder,
		});

		const result = await Promise.race([
			service
				.submit({
					payload: {
						conversationId: "conv_01HQ",
						prompt: "图书馆开放到几点？",
					},
					principal: createPrincipal(),
					waitUntil,
				})
				.then(() => "returned"),
			new Promise<"timed_out">((resolve) => {
				setTimeout(() => resolve("timed_out"), 25);
			}),
		]);

		expect(result).toBe("returned");
		expect(waitUntil).toHaveBeenCalledTimes(1);
		expect(traceBacklinkRecorder.record).toHaveBeenCalledTimes(1);
	});
}
