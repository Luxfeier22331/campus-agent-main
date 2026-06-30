// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import type { ExecutionControlRuntimeClient } from "../src/modules/integration/execution-control";
import { ExecutionControlTransportError } from "../src/modules/integration/execution-control";
import type { ChatCommandStreamEvent } from "../src/modules/runtime-command";
import { DEFAULT_DURABLE_EVENT_POLLING_POLICY } from "../src/modules/runtime-command/service/durable";
import { deriveLangfuseTraceId } from "../src/modules/telemetry/trace";
import {
	answerResponsePayload,
	durableEvent,
	emptyRunStepTrajectory,
} from "./chat-command.service.durable-cutover.test-support";
import {
	buildChatCommandService,
	createCommandStore,
	createConversationStore,
	createDeterministicIdGenerator,
	createPrincipal,
	createTelemetryMock,
	type ToolExecutionClient,
} from "./chat-command.service.test-support";

const EXPECTED_LANGFUSE_TRACE_PARENT = `00-${deriveLangfuseTraceId("trace_0001")}-0000000000000001-01`;

describe("chat command durable runtime cutover failure and streaming", () => {
	it("finalizes accepted requests as errors when durable run creation fails", async () => {
		const { store, acceptedWrites, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const executionClient: ToolExecutionClient = {
			execute: vi.fn(),
		};
		const executionRuntime: ExecutionControlRuntimeClient = {
			cancelRun: vi.fn(),
			createRun: vi.fn().mockRejectedValue(
				new ExecutionControlTransportError({
					code: "conversation_active_run",
					message: "Conversation already has an active primary run.",
					retryable: true,
					status: 409,
				}),
			),
			getRun: vi.fn(),
			listRunEvents: vi.fn(),
			listRunSteps: vi.fn().mockResolvedValue(emptyRunStepTrajectory()),
		};
		const service = buildChatCommandService({
			deriveSafetyIdentifier: () => "safety_0001",
			executionRuntime,
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-06-04T01:02:03.000Z"),
			conversationStore,
			store,
		});

		const response = await service.submit({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "中央民族大学本科学生国家奖学金评审办法",
				requestedTool: "knowledge_query",
			},
			principal: createPrincipal(),
			surface: "campus_web",
		});

		expect(acceptedWrites[0]).toMatchObject({
			requestExecution: {
				requestId: "req_0001",
				runId: "run_0001",
				status: "accepted",
			},
		});
		expect(executionClient.execute).not.toHaveBeenCalled();
		expect(finalWrites[0]).toMatchObject({
			requestExecution: {
				errorCode: "conversation_active_run",
				requestId: "req_0001",
				runId: "run_0001",
				status: "error",
			},
		});
		expect(response.answer.result).toMatchObject({
			errorCode: "conversation_active_run",
			kind: "error",
			requestId: "req_0001",
			retryable: true,
			traceId: "trace_0001",
		});
	});

	it("does not expose a resumable accepted event when durable run creation fails", async () => {
		const { store, acceptedWrites, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const executionClient: ToolExecutionClient = {
			execute: vi.fn(),
			executeStream: vi.fn(),
		};
		const executionRuntime: ExecutionControlRuntimeClient = {
			cancelRun: vi.fn(),
			createRun: vi.fn().mockRejectedValue(
				new ExecutionControlTransportError({
					code: "invalid_request",
					message: "metadata.execution_payload.trace.trace_id must match trace_id",
					retryable: false,
					status: 400,
				}),
			),
			getRun: vi.fn(),
			listRunEvents: vi.fn(),
			listRunSteps: vi.fn().mockResolvedValue(emptyRunStepTrajectory()),
		};
		const service = buildChatCommandService({
			deriveSafetyIdentifier: () => "safety_0001",
			executionRuntime,
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-06-04T01:02:03.000Z"),
			conversationStore,
			store,
		});

		const events: ChatCommandStreamEvent[] = [];
		for await (const event of service.submitStream?.({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "中央民族大学本科学生国家奖学金评审办法",
				requestedTool: "knowledge_query",
			},
			principal: createPrincipal(),
			surface: "campus_web",
		}) ?? []) {
			events.push(event);
		}

		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			data: {
				error: {
					code: "invalid_request",
					message: "metadata.execution_payload.trace.trace_id must match trace_id",
					retryable: false,
				},
				requestId: "req_0001",
				status: "error",
				traceId: "trace_0001",
			},
			event: "request.failed",
		});
		expect(events[0]?.data.runId).toBeUndefined();
		expect(acceptedWrites[0]).toMatchObject({
			requestExecution: {
				requestId: "req_0001",
				runId: "run_0001",
				status: "accepted",
			},
		});
		expect(finalWrites[0]).toMatchObject({
			requestExecution: {
				errorCode: "invalid_request",
				requestId: "req_0001",
				runId: "run_0001",
				status: "error",
			},
		});
		expect(executionClient.executeStream).not.toHaveBeenCalled();
		expect(executionRuntime.listRunEvents).not.toHaveBeenCalled();
	});

	it("keeps execution-control transport details out of user-visible streaming errors", async () => {
		const { store, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const executionRuntime: ExecutionControlRuntimeClient = {
			cancelRun: vi.fn(),
			createRun: vi.fn().mockRejectedValue(
				new ExecutionControlTransportError({
					code: "execution_control_unavailable",
					message: "Network connection lost.",
					retryable: true,
					status: 503,
				}),
			),
			getRun: vi.fn(),
			listRunEvents: vi.fn(),
			listRunSteps: vi.fn().mockResolvedValue(emptyRunStepTrajectory()),
		};
		const service = buildChatCommandService({
			deriveSafetyIdentifier: () => "safety_0001",
			executionRuntime,
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-06-04T01:02:03.000Z"),
			conversationStore,
			store,
		});

		const events: ChatCommandStreamEvent[] = [];
		for await (const event of service.submitStream?.({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "hi 你是谁",
			},
			principal: createPrincipal(),
			surface: "campus_web",
		}) ?? []) {
			events.push(event);
		}

		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			data: {
				answer: {
					result: {
						errorCode: "execution_control_unavailable",
						kind: "error",
						message: "问答服务暂时无法连接，请稍后再试。",
						retryable: true,
					},
				},
				error: {
					code: "execution_control_unavailable",
					message: "问答服务暂时无法连接，请稍后再试。",
					retryable: true,
				},
				status: "error",
			},
			event: "request.failed",
		});
		expect(events[0]?.data.answer?.conversation.messages.at(-1)).toMatchObject({
			kind: "error",
			role: "assistant",
			text: "问答服务暂时无法连接，请稍后再试。",
		});
		expect(finalWrites[0]).toMatchObject({
			requestExecution: {
				errorCode: "execution_control_unavailable",
				status: "error",
			},
		});
	});

	it("finalizes blocking durable requests as execution timeouts when polling budget expires", async () => {
		const { store, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const executionClient: ToolExecutionClient = {
			execute: vi.fn(),
		};
		const executionRuntime: ExecutionControlRuntimeClient = {
			cancelRun: vi.fn(),
			createRun: vi.fn().mockResolvedValue({
				admittedAt: "",
				completedAt: "",
				conversationId: "conv_01HQ",
				createdAt: "2026-06-04T01:02:03Z",
				failCloseReason: "",
				finalResponseRef: "",
				taskQueue: "campus-agent.workflow",
				ownerUserId: "user_01HQ",
				requestId: "req_0001",
				requestedTool: "knowledge_query",
				runId: "run_0001",
				selectedTool: "knowledge_query",
				startedAt: "",
				status: "queued",
				streamingStartedAt: "",
				surface: "campus_web",
				terminalReason: "",
				traceId: "trace_0001",
				turnId: "turn_0001",
				updatedAt: "2026-06-04T01:02:04Z",
				workflowPlanRef: "",
			}),
			getRun: vi.fn(),
			listRunEvents: vi
				.fn()
				.mockResolvedValueOnce([
					{
						conversationId: "conv_01HQ",
						eventId: "event-queued",
						eventType: "run.queued",
						occurredAt: "2026-06-04T01:02:04.000Z",
						payload: {
							status: "queued",
						},
						payloadSchemaVersion: "run-event-v1",
						runId: "run_0001",
						sequence: 1,
						visibility: "internal",
					},
				])
				.mockResolvedValueOnce([]),
			listRunSteps: vi.fn().mockResolvedValue(emptyRunStepTrajectory()),
		};
		const service = buildChatCommandService({
			deriveSafetyIdentifier: () => "safety_0001",
			durableEventPolling: {
				maxAttempts: 1,
				pollIntervalMs: 0,
				sleep: vi.fn(async () => undefined),
			},
			executionRuntime,
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-06-04T01:02:03.000Z"),
			conversationStore,
			store,
		});

		const response = await service.submit({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "中央民族大学本科学生国家奖学金评审办法",
				requestedTool: "knowledge_query",
			},
			principal: createPrincipal(),
			surface: "campus_web",
		});

		expect(executionClient.execute).not.toHaveBeenCalled();
		expect(finalWrites[0]).toMatchObject({
			requestExecution: {
				errorCode: "execution_timeout",
				requestId: "req_0001",
				runId: "run_0001",
				status: "error",
			},
		});
		expect(response.answer.result).toMatchObject({
			errorCode: "execution_timeout",
			kind: "error",
			retryable: true,
			traceId: "trace_0001",
		});
	});

	it("streams durable run events and finalizes from finalization completed event", async () => {
		const { store, acceptedWrites, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const telemetry = createTelemetryMock();
		const executionClient: ToolExecutionClient = {
			execute: vi.fn(),
			executeStream: vi.fn(),
		};
		const executionRuntime: ExecutionControlRuntimeClient = {
			cancelRun: vi.fn(),
			createRun: vi.fn().mockResolvedValue({
				admittedAt: "",
				completedAt: "",
				conversationId: "conv_01HQ",
				createdAt: "2026-06-04T01:02:03Z",
				failCloseReason: "",
				finalResponseRef: "",
				taskQueue: "campus-agent.workflow",
				ownerUserId: "user_01HQ",
				requestId: "req_0001",
				requestedTool: "knowledge_query",
				runId: "run_0001",
				selectedTool: "knowledge_query",
				startedAt: "",
				status: "queued",
				streamingStartedAt: "",
				surface: "campus_web",
				terminalReason: "",
				traceId: "trace_0001",
				turnId: "turn_0001",
				updatedAt: "2026-06-04T01:02:04Z",
				workflowPlanRef: "",
			}),
			getRun: vi.fn(),
			listRunEvents: vi
				.fn()
				.mockResolvedValueOnce([
					durableEvent({
						eventId: "event-queued",
						eventType: "run.queued",
						occurredAt: "2026-06-04T01:02:04.000Z",
						payload: { status: "queued" },
						sequence: 1,
						visibility: "internal",
					}),
					durableEvent({
						eventId: "event-started",
						eventType: "run.started",
						occurredAt: "2026-06-04T01:02:05.000Z",
						payload: { status: "running" },
						sequence: 2,
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
						sequence: 3,
						visibility: "browser",
					}),
				]),
			listRunSteps: vi.fn().mockResolvedValue(emptyRunStepTrajectory()),
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
			telemetry,
		});

		const events: Array<{
			event: string;
			runId?: string | null;
			runPhase?: string;
			status: string;
			text?: string;
		}> = [];
		for await (const event of service.submitStream?.({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "中央民族大学本科学生国家奖学金评审办法",
				requestedTool: "knowledge_query",
			},
			principal: createPrincipal(),
			surface: "campus_web",
		}) ?? []) {
			events.push({
				event: event.event,
				runId: event.data.runId,
				runPhase: event.data.runPhase,
				status: event.data.status,
				text:
					event.data.answer?.result.kind === "answer" ? event.data.answer.result.text : undefined,
			});
		}

		expect(executionClient.executeStream).not.toHaveBeenCalled();
		expect(executionRuntime.createRun).toHaveBeenCalledOnce();
		expect(executionRuntime.listRunEvents).toHaveBeenCalledWith({
			afterSequence: 0,
			runId: "run_0001",
			traceHeaders: {
				baggage: "sentry-environment=test",
				sentryTrace: "0123456789abcdef0123456789abcdef-0123456789abcdef-1",
				traceParent: EXPECTED_LANGFUSE_TRACE_PARENT,
			},
			traceId: "trace_0001",
			waitMs: DEFAULT_DURABLE_EVENT_POLLING_POLICY.waitMs,
		});
		expect(executionRuntime.listRunEvents).toHaveBeenCalledWith({
			afterSequence: 2,
			runId: "run_0001",
			traceHeaders: {
				baggage: "sentry-environment=test",
				sentryTrace: "0123456789abcdef0123456789abcdef-0123456789abcdef-1",
				traceParent: EXPECTED_LANGFUSE_TRACE_PARENT,
			},
			traceId: "trace_0001",
			waitMs: DEFAULT_DURABLE_EVENT_POLLING_POLICY.waitMs,
		});
		expect(events).toEqual([
			{
				event: "request.accepted",
				runId: "run_0001",
				runPhase: "queued",
				status: "accepted",
				text: undefined,
			},
			{
				event: "execution.queued",
				runId: undefined,
				runPhase: undefined,
				status: "queued",
				text: undefined,
			},
			{
				event: "execution.running",
				runId: undefined,
				runPhase: undefined,
				status: "running",
				text: undefined,
			},
			{
				event: "answer.delta",
				runId: "run_0001",
				runPhase: undefined,
				status: "streaming",
				text: undefined,
			},
			{
				event: "request.completed",
				runId: undefined,
				runPhase: undefined,
				status: "completed",
				text: "国家奖学金每学年评审一次。",
			},
		]);
		expect(acceptedWrites[0]).toMatchObject({
			requestExecution: {
				requestId: "req_0001",
				runId: "run_0001",
				status: "accepted",
			},
		});
		expect(finalWrites[0]).toMatchObject({
			requestExecution: {
				requestId: "req_0001",
				runId: "run_0001",
				status: "completed",
			},
		});
	});

	it("streams durable run cancellation as a cancelled terminal event", async () => {
		const { store, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const supervisor: ToolExecutionClient = {
			execute: vi.fn(),
			executeStream: vi.fn(),
		};
		const executionRuntime: ExecutionControlRuntimeClient = {
			cancelRun: vi.fn(),
			createRun: vi.fn().mockResolvedValue({
				admittedAt: "",
				completedAt: "",
				conversationId: "conv_01HQ",
				createdAt: "2026-06-04T01:02:03Z",
				failCloseReason: "",
				finalResponseRef: "",
				ownerUserId: "user_01HQ",
				requestId: "req_0001",
				requestedTool: "knowledge_query",
				runId: "run_0001",
				selectedTool: "knowledge_query",
				startedAt: "",
				taskQueue: "campus-agent.workflow",
				status: "queued",
				streamingStartedAt: "",
				surface: "campus_web",
				terminalReason: "",
				traceId: "trace_0001",
				turnId: "turn_0001",
				updatedAt: "2026-06-04T01:02:04Z",
				workflowPlanRef: "",
			}),
			getRun: vi.fn(),
			listRunEvents: vi
				.fn()
				.mockResolvedValueOnce([
					durableEvent({
						eventId: "event-queued",
						eventType: "run.queued",
						occurredAt: "2026-06-04T01:02:04.000Z",
						payload: { status: "queued" },
						sequence: 1,
						visibility: "browser",
					}),
				])
				.mockResolvedValueOnce([
					durableEvent({
						eventId: "event-canceled",
						eventType: "run.canceled",
						occurredAt: "2026-06-04T01:02:05.000Z",
						payload: {
							request_id: "req_0001",
							status: "canceled",
							terminal_reason: "user_canceled",
							trace_id: "trace_0001",
						},
						sequence: 2,
						visibility: "browser",
					}),
				]),
			listRunSteps: vi.fn().mockResolvedValue(emptyRunStepTrajectory()),
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

		const events: Array<{ event: string; status: string }> = [];
		for await (const event of service.submitStream?.({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "中央民族大学本科学生国家奖学金评审办法",
				requestedTool: "knowledge_query",
			},
			principal: createPrincipal(),
			surface: "campus_web",
		}) ?? []) {
			events.push({
				event: event.event,
				status: event.data.status,
			});
		}

		expect(supervisor.executeStream).not.toHaveBeenCalled();
		expect(events).toEqual([
			{ event: "request.accepted", status: "accepted" },
			{ event: "execution.queued", status: "queued" },
			{ event: "request.cancelled", status: "cancelled" },
		]);
		expect(finalWrites[0]).toMatchObject({
			requestExecution: {
				errorCode: "execution_cancelled",
				requestId: "req_0001",
				runId: "run_0001",
				status: "cancelled",
			},
		});
	});
});
