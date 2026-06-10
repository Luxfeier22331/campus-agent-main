import { expect, it, vi } from "vitest";

import {
	buildChatCommandService,
	type CapabilityExecutionClient,
	createCommandStore,
	createConversationStore,
	createDeterministicIdGenerator,
	createPrincipal,
	createTelemetryMock,
} from "./chat-command.service.test-support";

export function registerChatCommandServiceCoreLifecycleSuite(): void {
	it("streams lifecycle updates and finalizes app-api truth before terminal event", async () => {
		const { store, acceptedWrites, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const telemetry = createTelemetryMock();
		const supervisor: CapabilityExecutionClient = {
			execute: vi.fn(),
			executeStream: vi.fn().mockResolvedValue(
				new Response(
					[
						'event: execution.queued\ndata: {"request_id":"req_0001","trace_id":"trace_0001","status":"queued","occurred_at":"2026-03-28T08:00:00.500Z"}',
						'event: execution.running\ndata: {"request_id":"req_0001","trace_id":"trace_0001","status":"running","occurred_at":"2026-03-28T08:00:01.000Z"}',
						'event: execution.completed\ndata: {"request_id":"req_0001","trace_id":"trace_0002","status":"completed","occurred_at":"2026-03-28T08:00:02.000Z","response":{"answer_text":"图书馆开放到 22:00。","confidence":"high","error":null,"follow_up_question":"","result":{"evidence":{"sources":[{"doc_id":"handbook:library-hours"}]}},"selected_capability":"knowledge","status":"completed","trace_id":"trace_0002"}}',
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
			supervisor,
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
			surface: "public_chat_web",
		})) {
			events.push(event);
			if (event.event === "request.completed") {
				terminalFinalWriteCounts.push(finalWrites.length);
			}
		}

		expect(supervisor.execute).not.toHaveBeenCalled();
		expect(supervisor.executeStream).toHaveBeenCalledWith(
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
			"request.completed",
		]);
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
				traceId: "trace_0002",
			},
		});
		expect(finalWrites[0]).toMatchObject({
			outboxEvent: {
				eventType: "request.completed",
			},
			requestExecution: {
				requestId: "req_0001",
				selectedCapability: "knowledge",
				status: "completed",
				traceId: "trace_0002",
			},
		});
	});
	it("finalizes invalid supervisor stream terminal errors without defaulting missing fields", async () => {
		const { store, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const telemetry = createTelemetryMock();
		const supervisor: CapabilityExecutionClient = {
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
			supervisor,
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
			surface: "public_chat_web",
		})) {
			events.push(event);
		}

		expect(events.map((event) => event.event)).toEqual(["request.accepted", "request.failed"]);
		expect(events.at(-1)?.data.error).toMatchObject({
			code: "execution_control_invalid_response",
			retryable: true,
		});
		expect(finalWrites[0]).toMatchObject({
			requestExecution: {
				errorCode: "execution_control_invalid_response",
				status: "error",
			},
		});
		expect(telemetry.recordRequestTransportError).toHaveBeenCalledWith(
			expect.objectContaining({
				errorCode: "execution_control_invalid_response",
				retryable: true,
			}),
		);
	});
	it("leaves omitted requestedCapability unset so supervisor can infer the entrance intent", async () => {
		const { store, acceptedWrites, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const telemetry = createTelemetryMock();
		const supervisor: CapabilityExecutionClient = {
			execute: vi.fn().mockResolvedValue({
				answerText: "图书馆在海淀校区主教学区西侧。",
				error: null,
				followUpQuestion: "",
				result: {
					place_card: {
						location_description: "海淀校区主教学区西侧。",
						place: {
							display_name: "图书馆",
							entity_type: "building",
							place_id: "muc.haidian.library",
						},
					},
				},
				selectedCapability: "navigation",
				status: "completed",
				traceId: "trace_0002",
			}),
		};
		const service = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-04-11T09:00:00.000Z"),
			conversationStore,
			store,
			supervisor,
			telemetry,
		});

		await service.submit({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "图书馆在哪里",
			},
			principal: createPrincipal(),
			surface: "public_chat_web",
		});

		expect(supervisor.execute).toHaveBeenCalledWith(
			expect.objectContaining({
				requestedCapability: null,
				userGoal: "图书馆在哪里",
			}),
		);
		expect(acceptedWrites[0]).toMatchObject({
			requestExecution: {
				requestedCapability: null,
			},
			requestObservabilityFact: {
				requestedCapability: null,
			},
		});
		expect(finalWrites[0]).toMatchObject({
			requestExecution: {
				requestedCapability: null,
				selectedCapability: "navigation",
			},
			requestObservabilityFact: {
				requestedCapability: null,
			},
		});
		expect(telemetry.configureChatRequestScope).toHaveBeenCalledWith(
			expect.objectContaining({
				requestedCapability: null,
			}),
		);
	});
}
