// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import type { ExecutionControlRuntimeClient } from "../src/modules/integration/execution-control";
import { ExecutionControlTransportError } from "../src/modules/integration/execution-control";
import { DEFAULT_DURABLE_EVENT_POLLING_POLICY } from "../src/modules/runtime-command/service/durable";
import { deriveLangfuseTraceId } from "../src/modules/telemetry/trace";
import {
	answerResponsePayload,
	durableEvent,
	durableEventPage,
	durableRun,
	emptyRunStepTrajectory,
} from "./chat-command.service.durable-cutover.test-support";
import {
	buildChatCommandService,
	createCommandStore,
	createConversationStore,
	createDeterministicIdGenerator,
	createPrincipal,
	createTelemetryMock,
	getFrozenExecutionPayload,
	type ToolExecutionClient,
} from "./chat-command.service.test-support";

const EXPECTED_LANGFUSE_TRACE_PARENT = "00-5f8392c82813604cd79a0f7eb8b7306a-0000000000000001-01";

describe("chat command durable runtime cutover", () => {
	it("rejects blocking deployed chat commands when durable runtime is required but missing", async () => {
		const { store, acceptedWrites, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const executionClient: ToolExecutionClient = {
			execute: vi.fn(),
		};
		const service = buildChatCommandService({
			deriveSafetyIdentifier: () => "safety_0001",
			generateId: createDeterministicIdGenerator(),
			isExecutionRuntimeConfigured: false,
			now: () => new Date("2026-06-04T01:02:03.000Z"),
			conversationStore,
			store,
		});

		await expect(
			service.submit({
				payload: {
					conversationId: "conv_01HQ",
					prompt: "示例大学本科学生国家奖学金评审办法",
				},
				principal: createPrincipal(),
				requestKind: "public_chat",
			}),
		).rejects.toMatchObject({
			code: "execution_runtime_required",
			retryable: true,
			status: 503,
		});

		expect(acceptedWrites).toHaveLength(0);
		expect(finalWrites).toHaveLength(0);
		expect(executionClient.execute).not.toHaveBeenCalled();
	});

	it("rejects streaming deployed chat commands when durable runtime is required but missing", async () => {
		const { store, acceptedWrites, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const executionClient: ToolExecutionClient = {
			execute: vi.fn(),
			executeStream: vi.fn(),
		};
		const service = buildChatCommandService({
			deriveSafetyIdentifier: () => "safety_0001",
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-06-04T01:02:03.000Z"),
			conversationStore,
			store,
		});

		await expect(async () => {
			for await (const _event of service.submitStream?.({
				payload: {
					conversationId: "conv_01HQ",
					prompt: "示例大学本科学生国家奖学金评审办法",
				},
				principal: createPrincipal(),
				requestKind: "public_chat",
			}) ?? []) {
				throw new Error("stream should fail before emitting events");
			}
		}).rejects.toMatchObject({
			code: "execution_runtime_required",
			retryable: true,
			status: 503,
		});

		expect(acceptedWrites).toHaveLength(0);
		expect(finalWrites).toHaveLength(0);
		expect(executionClient.execute).not.toHaveBeenCalled();
		expect(executionClient.executeStream).not.toHaveBeenCalled();
	});

	it("rejects blocking deployed chat commands before accept when required durable config is absent", async () => {
		const { store, acceptedWrites, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const executionClient: ToolExecutionClient = {
			execute: vi.fn(),
		};
		const executionRuntime: ExecutionControlRuntimeClient = {
			cancelRun: vi.fn(),
			createRun: vi.fn().mockRejectedValue(
				new ExecutionControlTransportError({
					code: "dependency_not_ready",
					message: "Execution durable runtime is not configured.",
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
			isExecutionRuntimeConfigured: false,
			now: () => new Date("2026-06-04T01:02:03.000Z"),
			conversationStore,
			store,
		});

		await expect(
			service.submit({
				payload: {
					conversationId: "conv_01HQ",
					prompt: "示例大学本科学生国家奖学金评审办法",
				},
				principal: createPrincipal(),
				requestKind: "public_chat",
			}),
		).rejects.toMatchObject({
			code: "execution_runtime_required",
			retryable: true,
			status: 503,
		});

		expect(executionRuntime.createRun).not.toHaveBeenCalled();
		expect(acceptedWrites).toHaveLength(0);
		expect(finalWrites).toHaveLength(0);
		expect(executionClient.execute).not.toHaveBeenCalled();
	});

	it("finalizes blocking accepted chat requests from durable finalization events", async () => {
		const { store, acceptedWrites, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const telemetry = createTelemetryMock();
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
				ownerUserId: "user_01HQ",
				queuedAt: "2026-06-04T01:02:03Z",
				requestId: "req_0001",
				runId: "run_0001",
				startedAt: "",
				status: "queued",
				streamingStartedAt: "",
				surface: "campus_web",
				taskQueue: "campus-agent.workflow",
				terminalReason: "",
				traceId: "trace_0001",
				turnId: "turn_0001",
				updatedAt: "2026-06-04T01:02:04Z",
			}),
			getRun: vi.fn(),
			listRunEvents: vi.fn().mockResolvedValue(
				durableEventPage([
					{
						conversationId: "conv_01HQ",
						eventId: "event-final",
						eventType: "finalization.completed",
						occurredAt: "2026-06-04T01:02:06.000Z",
						payload: {
							request_id: "req_0001",
							trace_id: "trace_0001",
							response: answerResponsePayload(),
						},
						payloadSchemaVersion: "run-event-v1",
						runId: "run_0001",
						sequence: 1,
						visibility: "internal",
					},
				]),
			),
			listRunSteps: vi.fn().mockResolvedValue(emptyRunStepTrajectory()),
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

		await service.submit({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "示例大学本科学生国家奖学金评审办法",
			},
			principal: createPrincipal(),
			requestKind: "public_chat",
			traceHeaders: {
				baggage: "release=2026.06.18",
				sentryTrace: "fedcba9876543210fedcba9876543210-0123456789abcdef-1",
				traceParent: EXPECTED_LANGFUSE_TRACE_PARENT,
			},
		});

		expect(executionRuntime.createRun).toHaveBeenCalledOnce();
		const createRunInput = (executionRuntime.createRun as ReturnType<typeof vi.fn>).mock
			.calls[0]?.[0];
		const executionPayload = getFrozenExecutionPayload(createRunInput?.runId ?? "run_0001");
		expect(Object.keys(executionPayload).sort()).toEqual([
			"context",
			"conversation_id",
			"execution_contract_version",
			"request_id",
			"response_contract",
			"safety_identifier",
			"tenant_id",
			"trace",
			"user_goal",
		]);
		expect(executionPayload).toMatchObject({
			execution_contract_version: "tool_execution_v5",
			response_contract: "execution_finalization_response_v5",
			tenant_id: "tenant-main",
			trace: {
				trace_id: "trace_0001",
			},
			user_goal: "示例大学本科学生国家奖学金评审办法",
		});
		expect(createRunInput).not.toHaveProperty("selectedTool");
		expect(createRunInput).not.toHaveProperty("requestedTool");
		expect(createRunInput).not.toHaveProperty("taskQueue");
		expect(executionRuntime.createRun).toHaveBeenCalledWith(
			expect.objectContaining({
				conversationId: "conv_01HQ",
				metadata: expect.objectContaining({
					execution_contract_version: "tool_execution_v5",
					execution_input_ref: "app-api://execution-inputs/run_0001",
					execution_input_sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
				}),
				ownerUserId: "user_01HQ",
				requestId: "req_0001",
				runId: "run_0001",
				runtimeVersions: {
					contract: "durable-agent-runtime-contract-v1",
				},
				surface: "campus_web",
				traceHeaders: {
					traceParent: EXPECTED_LANGFUSE_TRACE_PARENT,
				},
				traceId: "trace_0001",
				turnId: "turn_0001",
			}),
		);
		expect(acceptedWrites[0]).toMatchObject({
			turnDispatch: {
				requestId: "req_0001",
				runId: "run_0001",
				status: "accepted",
			},
		});
		expect(finalWrites).toHaveLength(1);
		expect(executionClient.execute).not.toHaveBeenCalled();
		expect(executionRuntime.listRunEvents).toHaveBeenCalledWith({
			afterSequence: 0,
			runId: "run_0001",
			traceHeaders: {
				traceParent: EXPECTED_LANGFUSE_TRACE_PARENT,
			},
			traceId: "trace_0001",
			waitMs: DEFAULT_DURABLE_EVENT_POLLING_POLICY.waitMs,
		});
	});

	it("finalizes blocking accepted chat requests from durable run failed events", async () => {
		const { store, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const executionRuntime: ExecutionControlRuntimeClient = {
			cancelRun: vi.fn(),
			createRun: vi.fn().mockResolvedValue(durableRun()),
			getRun: vi.fn(),
			listRunEvents: vi
				.fn()
				.mockResolvedValueOnce(
					durableEventPage([
						durableEvent({
							eventType: "run.failed",
							payload: {
								error: {
									code: "agent_runtime_timeout",
									message: "provider rejected sk-sensitive-token",
									retryable: true,
								},
								failure_kind: "agent_runtime_timeout",
								request_id: "req_0001",
								status: "failed",
								terminal_reason: "worker_unavailable",
								trace_id: "trace_0001",
							},
							sequence: 1,
						}),
					]),
				)
				.mockResolvedValue(durableEventPage([], 1)),
			listRunSteps: vi.fn().mockResolvedValue(emptyRunStepTrajectory()),
		};
		const service = buildChatCommandService({
			deriveSafetyIdentifier: () => "safety_0001",
			durableEventPolling: {
				maxAttempts: 1,
			},
			executionRuntime,
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-06-04T01:02:03.000Z"),
			conversationStore,
			store,
		});

		await service.submit({
			payload: { conversationId: "conv_01HQ", prompt: "校园卡丢了怎么办" },
			principal: createPrincipal(),
			requestKind: "public_chat",
		});

		expect(finalWrites).toHaveLength(1);
		expect(finalWrites[0]?.assistantMessage.text).toBe(
			"The agent runtime did not complete before its deadline.",
		);
		expect(executionRuntime.listRunEvents).toHaveBeenCalledTimes(1);
	});

	it("injects deterministic W3C traceparent into durable runtime calls when inbound traceparent is absent", async () => {
		const { store } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const telemetry = createTelemetryMock();
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
				queuedAt: "2026-06-04T01:02:03Z",
				requestId: "req_0001",
				runId: "run_0001",
				startedAt: "",
				status: "queued",
				streamingStartedAt: "",
				surface: "campus_web",
				taskQueue: "campus-agent.workflow",
				terminalReason: "",
				traceId: "trace_0001",
				turnId: "turn_0001",
				updatedAt: "2026-06-04T01:02:04Z",
			}),
			getRun: vi.fn(),
			listRunEvents: vi.fn().mockResolvedValue(
				durableEventPage([
					durableEvent({
						eventType: "finalization.completed",
						sequence: 1,
						payload: {
							request_id: "req_0001",
							trace_id: "trace_0001",
							response: answerResponsePayload("国家奖学金每学年评审一次。"),
						},
						visibility: "internal",
					}),
				]),
			),
			listRunSteps: vi.fn().mockResolvedValue(emptyRunStepTrajectory()),
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

		await service.submit({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "示例大学本科学生国家奖学金评审办法",
			},
			principal: createPrincipal(),
			requestKind: "public_chat",
		});

		const langfuseTraceId = await deriveLangfuseTraceId("trace_0001");
		const expectedTraceParent = `00-${langfuseTraceId}-0000000000000001-01`;
		expect(executionRuntime.createRun).toHaveBeenCalledWith(
			expect.objectContaining({
				traceHeaders: expect.objectContaining({
					traceParent: expectedTraceParent,
				}),
			}),
		);
		expect(executionRuntime.listRunEvents).toHaveBeenCalledWith(
			expect.objectContaining({
				traceHeaders: expect.objectContaining({
					traceParent: expectedTraceParent,
				}),
			}),
		);
	});

	it("rejects retired client routing hints on public chat", async () => {
		const { store, acceptedWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const executionRuntime: ExecutionControlRuntimeClient = {
			cancelRun: vi.fn(),
			createRun: vi.fn(),
			getRun: vi.fn(),
			listRunEvents: vi.fn(),
			listRunSteps: vi.fn(),
		};
		const service = buildChatCommandService({
			deriveSafetyIdentifier: () => "safety_0001",
			executionRuntime,
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-06-04T01:02:03.000Z"),
			conversationStore,
			store,
		});

		await expect(
			service.submit({
				payload: {
					conversationId: "conv_01HQ",
					prompt: "海淀校区图书馆现在开门吗？",
					requestedTool: "knowledge_query",
				} as never,
				principal: createPrincipal(),
				requestKind: "public_chat",
			}),
		).rejects.toMatchObject({
			code: "validation_failed",
			details: { field: "requestedTool" },
		});

		expect(executionRuntime.createRun).not.toHaveBeenCalled();
		expect(acceptedWrites).toHaveLength(0);
	});

	it("keeps durable input free of client routing hints", async () => {
		const { store } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const executionRuntime: ExecutionControlRuntimeClient = {
			cancelRun: vi.fn(),
			createRun: vi.fn().mockResolvedValue(
				durableRun({
					taskQueue: "campus-agent.workflow",
				}),
			),
			getRun: vi.fn(),
			listRunEvents: vi.fn().mockResolvedValue(
				durableEventPage([
					durableEvent({
						eventId: "event-final",
						eventType: "finalization.completed",
						payload: {
							request_id: "req_0001",
							response: {
								...answerResponsePayload("图书馆在海淀校区主教学区西侧。"),
							},
							trace_id: "trace_0001",
						},
						sequence: 1,
						visibility: "internal",
					}),
				]),
			),
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

		await service.submit({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "图书馆在哪里",
			},
			principal: createPrincipal(),
			requestKind: "public_chat",
		});

		expect(executionRuntime.createRun).toHaveBeenCalledOnce();
		const createRunInput = (executionRuntime.createRun as ReturnType<typeof vi.fn>).mock
			.calls[0]?.[0];
		expect(createRunInput).not.toHaveProperty("requestedTool");
		expect(createRunInput).not.toHaveProperty("taskQueue");
		const executionPayload = getFrozenExecutionPayload(createRunInput?.runId ?? "run_0001");
		expect(executionPayload).not.toHaveProperty("requested_tool");
		expect(executionPayload).toMatchObject({ user_goal: "图书馆在哪里" });
	});

	it("polls blocking durable run events by cursor until terminal finalization arrives", async () => {
		const { store, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const telemetry = createTelemetryMock();
		const executionClient: ToolExecutionClient = {
			execute: vi.fn(),
		};
		const listRunEvents = vi
			.fn()
			.mockResolvedValueOnce(
				durableEventPage([
					durableEvent({
						eventType: "run.queued",
						payload: { status: "queued" },
						sequence: 1,
					}),
				]),
			)
			.mockResolvedValueOnce(
				durableEventPage([
					durableEvent({
						eventId: "event-final",
						eventType: "finalization.completed",
						occurredAt: "2026-06-04T01:02:06.000Z",
						payload: {
							request_id: "req_0001",
							response: answerResponsePayload(),
							trace_id: "trace_0001",
						},
						sequence: 2,
						visibility: "internal",
					}),
				]),
			);
		const executionRuntime: ExecutionControlRuntimeClient = {
			cancelRun: vi.fn(),
			createRun: vi.fn().mockResolvedValue(durableRun()),
			getRun: vi.fn(),
			listRunEvents,
			listRunSteps: vi.fn().mockResolvedValue(emptyRunStepTrajectory()),
		};
		const service = buildChatCommandService({
			deriveSafetyIdentifier: () => "safety_0001",
			durableEventPolling: {
				maxAttempts: 2,
			},
			executionRuntime,
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-06-04T01:02:03.000Z"),
			conversationStore,
			store,
			telemetry,
		});

		await service.submit({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "示例大学本科学生国家奖学金评审办法",
			},
			principal: createPrincipal(),
			requestKind: "public_chat",
		});

		expect(executionClient.execute).not.toHaveBeenCalled();
		expect(listRunEvents).toHaveBeenNthCalledWith(1, {
			afterSequence: 0,
			runId: "run_0001",
			traceHeaders: {
				traceParent: EXPECTED_LANGFUSE_TRACE_PARENT,
			},
			traceId: "trace_0001",
			waitMs: DEFAULT_DURABLE_EVENT_POLLING_POLICY.waitMs,
		});
		expect(listRunEvents).toHaveBeenNthCalledWith(2, {
			afterSequence: 1,
			runId: "run_0001",
			traceHeaders: {
				traceParent: EXPECTED_LANGFUSE_TRACE_PARENT,
			},
			traceId: "trace_0001",
			waitMs: DEFAULT_DURABLE_EVENT_POLLING_POLICY.waitMs,
		});
		expect(finalWrites).toHaveLength(1);
	});
});
