import { expect, it, vi } from "vitest";

import {
	buildChatCommandService,
	createCommandStore,
	createConversationStore,
	createDeterministicIdGenerator,
	createExecutionRuntimeFromToolClient,
	createPrincipal,
	createTelemetryMock,
	type ToolExecutionClient,
} from "./chat-command.service.test-support";

export function registerChatCommandServiceCoreLifecycleSuite(): void {
	it("streams lifecycle updates and finalizes app-api truth before terminal event", async () => {
		const { store, acceptedWrites, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const telemetry = createTelemetryMock();
		const executionClient: ToolExecutionClient = {
			execute: vi.fn(),
			executeStream: vi.fn().mockResolvedValue(
				new Response(
					[
						'event: execution.queued\ndata: {"request_id":"req_0001","trace_id":"trace_0001","status":"queued","occurred_at":"2026-03-28T08:00:00.500Z"}',
						'event: execution.running\ndata: {"request_id":"req_0001","trace_id":"trace_0001","status":"running","occurred_at":"2026-03-28T08:00:01.000Z"}',
						'event: execution.completed\ndata: {"request_id":"req_0001","trace_id":"trace_0001","status":"completed","occurred_at":"2026-03-28T08:00:02.000Z","response":{"answer_text":"图书馆开放到 22:00。","confidence":"high","error":null,"follow_up_question":"","model_usage":{"cached_input_tokens":10,"input_tokens":120,"output_tokens":42,"total_tokens":162},"result":{"sources":[]},"status":"completed","trace_id":"trace_0001"}}',
					].join("\n\n"),
					{
						headers: {
							"content-type": "text/event-stream; charset=utf-8",
						},
						status: 200,
					},
				),
			),
		};
		const service = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-03-28T08:00:00.000Z"),
			conversationStore,
			store,
			executionRuntime: createExecutionRuntimeFromToolClient(executionClient),
			telemetry,
		});
		if (!service.submitStream) {
			throw new Error("Expected chat command stream support.");
		}

		const events: Array<{ event: string; data: { answer?: unknown } }> = [];
		const terminalFinalWriteCounts: number[] = [];
		for await (const event of service.submitStream({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "图书馆开放到几点？",
			},
			principal: createPrincipal(),
			requestKind: "public_chat",
		})) {
			events.push(event);
			if (event.event === "request.completed") {
				terminalFinalWriteCounts.push(finalWrites.length);
			}
		}

		expect(executionClient.execute).not.toHaveBeenCalled();
		expect(executionClient.executeStream).toHaveBeenCalledWith(
			expect.objectContaining({
				conversationId: "conv_01HQ",
				requestId: "req_0001",
				traceId: "trace_0001",
				userGoal: "图书馆开放到几点？",
			}),
		);
		expect(acceptedWrites).toHaveLength(1);
		expect(finalWrites).toHaveLength(1);
		expect(terminalFinalWriteCounts).toEqual([1]);
		expect(events.map((event) => event.event)).toEqual([
			"request.accepted",
			"execution.queued",
			"execution.running",
			"answer.delta",
			"request.completed",
		]);
		expect(events.find((event) => event.event === "answer.delta")?.data).toMatchObject({
			delta: "图书馆开放到 22:00。",
			status: "streaming",
		});
		expect(events.at(-1)?.data.answer).toMatchObject({
			conversation: {
				id: "conv_01HQ",
				messages: [
					{
						role: "user",
						text: "图书馆开放到几点？",
					},
					{
						kind: "answer",
						role: "assistant",
						text: "图书馆开放到 22:00。",
					},
				],
			},
			result: {
				kind: "answer",
				requestId: "req_0001",
				text: "图书馆开放到 22:00。",
				traceId: "trace_0001",
			},
		});
		expect(finalWrites[0]).toMatchObject({
			turnDispatch: {
				requestId: "req_0001",
				status: "completed",
			},
			requestObservabilityFact: {
				traceId: "trace_0001",
			},
		});
	});
	it("finalizes invalid execution stream terminal errors without defaulting missing fields", async () => {
		const { store, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const telemetry = createTelemetryMock();
		const executionClient: ToolExecutionClient = {
			execute: vi.fn(),
			executeStream: vi.fn().mockResolvedValue(
				new Response(
					'event: execution.failed\ndata: {"request_id":"req_0001","trace_id":"trace_0001","occurred_at":"2026-03-28T08:00:02.000Z","error":{}}\n\n',
					{
						headers: {
							"content-type": "text/event-stream; charset=utf-8",
						},
						status: 200,
					},
				),
			),
		};
		const service = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-03-28T08:00:00.000Z"),
			conversationStore,
			store,
			executionRuntime: createExecutionRuntimeFromToolClient(executionClient),
			telemetry,
		});
		if (!service.submitStream) {
			throw new Error("Expected chat command stream support.");
		}

		const events: Array<{ event: string; data: { answer?: unknown; error?: unknown } }> = [];
		for await (const event of service.submitStream({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "图书馆开放到几点？",
			},
			principal: createPrincipal(),
			requestKind: "public_chat",
		})) {
			events.push(event);
		}

		expect(events.map((event) => event.event)).toEqual(["request.accepted", "request.failed"]);
		expect(events.at(-1)?.data.error).toMatchObject({
			code: "execution_control_invalid_response",
			retryable: true,
		});
		expect(finalWrites[0]).toMatchObject({
			turnDispatch: {
				errorCode: "execution_control_invalid_response",
				status: "error",
			},
		});
		expect(telemetry.configureRequestOutcome).toHaveBeenCalledWith(
			expect.objectContaining({
				errorCode: "execution_control_invalid_response",
				status: "error",
			}),
		);
	});
	it("lets the agent infer routing from a route-free user goal", async () => {
		const { store, acceptedWrites, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const telemetry = createTelemetryMock();
		const executionClient: ToolExecutionClient = {
			execute: vi.fn().mockResolvedValue({
				answerText: "学校官网显示图书馆位于海淀校区主教学区西侧。",
				error: null,
				followUpQuestion: "",
				modelUsage: { cachedInputTokens: 10, inputTokens: 120, outputTokens: 42, totalTokens: 162 },
				result: {
					outcome: "resolved_current",
					query_text: "图书馆在哪里",
				},
				status: "completed",
				traceId: "trace_0001",
			}),
		};
		const service = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-04-11T09:00:00.000Z"),
			conversationStore,
			store,
			executionRuntime: createExecutionRuntimeFromToolClient(executionClient),
			telemetry,
		});

		await service.submit({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "图书馆在哪里",
			},
			principal: createPrincipal(),
			requestKind: "public_chat",
		});

		expect(executionClient.execute).toHaveBeenCalledWith(
			expect.objectContaining({
				userGoal: "图书馆在哪里",
			}),
		);
		expect(acceptedWrites[0]).toMatchObject({
			turnDispatch: {},
			requestObservabilityFact: {},
		});
		expect(finalWrites[0]).toMatchObject({
			turnDispatch: {},
			requestObservabilityFact: {},
		});
		expect(telemetry.configureChatRequestScope).toHaveBeenCalledWith(expect.objectContaining({}));
	});
}
