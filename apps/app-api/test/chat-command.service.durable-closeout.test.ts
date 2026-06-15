// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import type {
	ExecutionControlRun,
	ExecutionControlRunEvent,
	ExecutionControlRuntimeClient,
} from "../src/modules/integration/execution-control";
import { DEFAULT_DURABLE_EVENT_POLLING_POLICY } from "../src/modules/runtime-command/service/durable";
import {
	buildChatCommandService,
	type CapabilityExecutionClient,
	createCommandStore,
	createConversationStore,
	createDeterministicIdGenerator,
	createPrincipal,
	createTelemetryMock,
} from "./chat-command.service.test-support";

function durableRun(overrides: Partial<ExecutionControlRun> = {}): ExecutionControlRun {
	return {
		admittedAt: "",
		completedAt: "",
		conversationId: "conv_01HQ",
		createdAt: "2026-06-04T01:02:03Z",
		failCloseReason: "",
		finalResponseRef: "",
		lane: "rag",
		ownerUserId: "user_01HQ",
		requestId: "req_0001",
		requestedCapability: "knowledge",
		runId: "run_0001",
		selectedCapability: "knowledge",
		startedAt: "",
		status: "queued",
		streamingStartedAt: "",
		surface: "public_chat_web",
		terminalReason: "",
		traceId: "trace_0001",
		turnId: "turn_0001",
		updatedAt: "2026-06-04T01:02:04Z",
		workflowPlanRef: "",
		...overrides,
	};
}

function answerResponsePayload(text = "国家奖学金每学年评审一次。") {
	return {
		answer_text: text,
		confidence: "high",
		error: null,
		follow_up_question: "",
		observability: {
			citation_count: 1,
			citation_expected: true,
			citation_missing: false,
			fail_closed: false,
			retrieval_attempted: true,
			retrieved_source_count: 1,
		},
		result: {
			evidence: {
				sources: [{ doc_id: "student_rules:national-scholarship" }],
			},
		},
		selected_capability: "knowledge",
		status: "completed",
		trace_id: "trace_0001",
	};
}

function durableEvent(
	overrides: Partial<ExecutionControlRunEvent> & {
		eventType: string;
		sequence: number;
	},
): ExecutionControlRunEvent {
	const { eventType, sequence, ...rest } = overrides;
	return {
		conversationId: "conv_01HQ",
		eventId: `event-${sequence}`,
		eventType,
		occurredAt: "2026-06-04T01:02:04.000Z",
		payload: {},
		payloadSchemaVersion: "run-event-v1",
		runId: "run_0001",
		sequence,
		visibility: "browser",
		...rest,
	};
}

describe("chat command durable stream closeout", () => {
	it("keeps the default closeout polling budget below the Worker subrequest ceiling", () => {
		expect(DEFAULT_DURABLE_EVENT_POLLING_POLICY.maxAttempts).toBeLessThanOrEqual(20);
		expect(DEFAULT_DURABLE_EVENT_POLLING_POLICY.pollIntervalMs).toBeGreaterThanOrEqual(1000);
	});

	it("continues durable finalization through waitUntil when the submit stream consumer disconnects after accept", async () => {
		const { store, acceptedWrites, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const telemetry = createTelemetryMock();
		const waitUntilPromises: Promise<unknown>[] = [];
		const supervisor: CapabilityExecutionClient = {
			execute: vi.fn(),
			executeStream: vi.fn(),
		};
		const executionRuntime: ExecutionControlRuntimeClient = {
			cancelRun: vi.fn(),
			createRun: vi.fn().mockResolvedValue(durableRun()),
			getRun: vi.fn(),
			listRunEvents: vi.fn().mockResolvedValue([
				durableEvent({
					eventId: "event-final",
					eventType: "finalization.completed",
					occurredAt: "2026-06-04T01:02:06.000Z",
					payload: {
						request_id: "req_0001",
						response: answerResponsePayload(),
						trace_id: "trace_0001",
					},
					sequence: 1,
				}),
			]),
			listRunSteps: vi.fn().mockResolvedValue({ attempts: [], results: [], steps: [] }),
		};
		const service = buildChatCommandService({
			deriveSafetyIdentifier: () => "safety_0001",
			executionRuntime,
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-06-04T01:02:03.000Z"),
			conversationStore,
			store,
			telemetry,
		});

		const stream = service.submitStream?.({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "中央民族大学本科学生国家奖学金评审办法",
				requestedCapability: "knowledge",
			},
			principal: createPrincipal(),
			surface: "public_chat_web",
			waitUntil: (promise) => {
				waitUntilPromises.push(promise);
			},
		});
		expect(stream).toBeDefined();
		if (!stream) {
			throw new Error("durable submitStream should return an async event stream.");
		}
		const iterator = stream[Symbol.asyncIterator]();
		const first = await iterator.next();
		expect(first.value).toMatchObject({
			data: {
				requestId: "req_0001",
				runId: "run_0001",
				runPhase: "queued",
				status: "accepted",
				traceId: "trace_0001",
			},
			event: "request.accepted",
		});
		await iterator.return?.();

		expect(acceptedWrites[0]).toMatchObject({
			requestExecution: {
				requestId: "req_0001",
				runId: "run_0001",
				status: "accepted",
			},
		});
		expect(executionRuntime.createRun).toHaveBeenCalledOnce();
		expect(waitUntilPromises).toHaveLength(1);
		await waitUntilPromises[0];
		expect(supervisor.execute).not.toHaveBeenCalled();
		expect(supervisor.executeStream).not.toHaveBeenCalled();
		expect(executionRuntime.listRunEvents).toHaveBeenCalledWith({
			afterSequence: 0,
			runId: "run_0001",
			traceHeaders: {
				baggage: "sentry-environment=test",
				sentryTrace: "0123456789abcdef0123456789abcdef-0123456789abcdef-1",
			},
			traceId: "trace_0001",
			waitMs: DEFAULT_DURABLE_EVENT_POLLING_POLICY.waitMs,
		});
		expect(finalWrites).toHaveLength(1);
		expect(finalWrites[0]).toMatchObject({
			requestExecution: {
				requestId: "req_0001",
				runId: "run_0001",
				status: "completed",
			},
		});
	});

	it("shares one durable finalization closeout between submit stream and waitUntil", async () => {
		const { store, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const waitUntilPromises: Promise<unknown>[] = [];
		const supervisor: CapabilityExecutionClient = {
			execute: vi.fn(),
			executeStream: vi.fn(),
		};
		const executionRuntime: ExecutionControlRuntimeClient = {
			cancelRun: vi.fn(),
			createRun: vi.fn().mockResolvedValue(durableRun()),
			getRun: vi.fn(),
			listRunEvents: vi.fn().mockResolvedValue([
				durableEvent({
					eventId: "event-final",
					eventType: "finalization.completed",
					occurredAt: "2026-06-04T01:02:06.000Z",
					payload: {
						request_id: "req_0001",
						response: answerResponsePayload(),
						trace_id: "trace_0001",
					},
					sequence: 1,
				}),
			]),
			listRunSteps: vi.fn().mockResolvedValue({ attempts: [], results: [], steps: [] }),
		};
		const service = buildChatCommandService({
			deriveSafetyIdentifier: () => "safety_0001",
			executionRuntime,
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-06-04T01:02:03.000Z"),
			conversationStore,
			store,
		});

		const events: string[] = [];
		for await (const event of service.submitStream?.({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "中央民族大学本科学生国家奖学金评审办法",
				requestedCapability: "knowledge",
			},
			principal: createPrincipal(),
			surface: "public_chat_web",
			waitUntil: (promise) => {
				waitUntilPromises.push(promise);
			},
		}) ?? []) {
			events.push(event.event);
		}

		expect(waitUntilPromises).toHaveLength(1);
		await waitUntilPromises[0];
		expect(events).toEqual(["request.accepted", "request.completed"]);
		expect(finalWrites).toHaveLength(1);
		expect(executionRuntime.listRunEvents).toHaveBeenCalledTimes(1);
		expect(supervisor.execute).not.toHaveBeenCalled();
		expect(supervisor.executeStream).not.toHaveBeenCalled();
	});

	it("does not consume the empty-poll budget while durable progress events keep advancing", async () => {
		const { store, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const supervisor: CapabilityExecutionClient = {
			execute: vi.fn(),
			executeStream: vi.fn(),
		};
		const executionRuntime: ExecutionControlRuntimeClient = {
			cancelRun: vi.fn(),
			createRun: vi.fn().mockResolvedValue(durableRun()),
			getRun: vi.fn(),
			listRunEvents: vi
				.fn()
				.mockResolvedValueOnce([
					durableEvent({
						eventType: "workflow.started",
						sequence: 1,
						visibility: "internal",
					}),
				])
				.mockResolvedValueOnce([
					durableEvent({
						eventType: "agent.completed",
						sequence: 2,
						visibility: "internal",
					}),
				])
				.mockResolvedValueOnce([
					durableEvent({
						eventType: "activity.completed",
						sequence: 3,
						visibility: "internal",
					}),
				])
				.mockResolvedValueOnce([
					durableEvent({
						eventId: "event-final",
						eventType: "finalization.completed",
						occurredAt: "2026-06-04T01:02:06.000Z",
						payload: {
							request_id: "req_0001",
							response: answerResponsePayload(),
							trace_id: "trace_0001",
						},
						sequence: 4,
					}),
				]),
			listRunSteps: vi.fn().mockResolvedValue({ attempts: [], results: [], steps: [] }),
		};
		const service = buildChatCommandService({
			deriveSafetyIdentifier: () => "safety_0001",
			durableEventPolling: {
				maxAttempts: 2,
				pollIntervalMs: 0,
				sleep: vi.fn(async () => undefined),
			},
			executionRuntime,
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-06-04T01:02:03.000Z"),
			conversationStore,
			store,
		});

		const events: string[] = [];
		for await (const event of service.submitStream?.({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "中央民族大学本科学生国家奖学金评审办法",
				requestedCapability: "knowledge",
			},
			principal: createPrincipal(),
			surface: "public_chat_web",
		}) ?? []) {
			events.push(event.event);
		}

		expect(events).toEqual(["request.accepted", "request.completed"]);
		expect(finalWrites[0]).toMatchObject({
			requestExecution: {
				errorCode: null,
				requestId: "req_0001",
				runId: "run_0001",
				status: "completed",
			},
		});
		expect(executionRuntime.listRunEvents).toHaveBeenCalledTimes(4);
		expect(supervisor.execute).not.toHaveBeenCalled();
		expect(supervisor.executeStream).not.toHaveBeenCalled();
	});
});
