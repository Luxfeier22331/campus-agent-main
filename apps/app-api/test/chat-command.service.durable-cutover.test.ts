// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import type { ExecutionControlRuntimeClient } from "../src/modules/integration/execution-control";
import { ExecutionControlTransportError } from "../src/modules/integration/execution-control";
import { DEFAULT_DURABLE_EVENT_POLLING_POLICY } from "../src/modules/runtime-command/service/durable";
import { deriveLangfuseTraceId } from "../src/modules/telemetry/trace";
import {
	answerResponsePayload,
	durableEvent,
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
	type ToolExecutionClient,
} from "./chat-command.service.test-support";

const EXPECTED_LANGFUSE_TRACE_PARENT = `00-${deriveLangfuseTraceId("trace_0001")}-0000000000000001-01`;

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
			requireExecutionRuntime: true,
			store,
		});

		await expect(
			service.submit({
				payload: {
					conversationId: "conv_01HQ",
					prompt: "示例大学本科学生国家奖学金评审办法",
					requestedTool: "knowledge_query",
				},
				principal: createPrincipal(),
				surface: "campus_web",
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
			requireExecutionRuntime: true,
			store,
		});

		await expect(async () => {
			for await (const _event of service.submitStream?.({
				payload: {
					conversationId: "conv_01HQ",
					prompt: "示例大学本科学生国家奖学金评审办法",
					requestedTool: "knowledge_query",
				},
				principal: createPrincipal(),
				surface: "campus_web",
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
			requireExecutionRuntime: true,
			store,
		});

		await expect(
			service.submit({
				payload: {
					conversationId: "conv_01HQ",
					prompt: "示例大学本科学生国家奖学金评审办法",
					requestedTool: "knowledge_query",
				},
				principal: createPrincipal(),
				surface: "campus_web",
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
				requestId: "req_0001",
				requestedTool: "knowledge_query",
				runId: "run_0001",
				selectedTool: "knowledge_query",
				startedAt: "",
				status: "queued",
				streamingStartedAt: "",
				surface: "campus_web",
				taskQueue: "campus-agent.workflow",
				terminalReason: "",
				traceId: "trace_0001",
				turnId: "turn_0001",
				updatedAt: "2026-06-04T01:02:04Z",
				workflowPlanRef: "",
			}),
			getRun: vi.fn(),
			listRunEvents: vi.fn().mockResolvedValue([
				{
					conversationId: "conv_01HQ",
					eventId: "event-final",
					eventType: "finalization.completed",
					occurredAt: "2026-06-04T01:02:06.000Z",
					payload: {
						request_id: "req_0001",
						trace_id: "trace_0001",
						response: {
							answer_text: "国家奖学金每学年评审一次。",
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
							selected_tool: "knowledge_query",
							status: "completed",
							trace_id: "trace_0001",
						},
					},
					payloadSchemaVersion: "run-event-v1",
					runId: "run_0001",
					sequence: 1,
					visibility: "internal",
				},
			]),
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

		const response = await service.submit({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "示例大学本科学生国家奖学金评审办法",
				requestedTool: "knowledge_query",
				requestedScope: {
					collection: "student_rules",
					corpus: "regulations",
				},
			},
			principal: createPrincipal(),
			surface: "campus_web",
			traceHeaders: {
				baggage: "release=2026.06.18",
				sentryTrace: "fedcba9876543210fedcba9876543210-0123456789abcdef-1",
				traceParent: EXPECTED_LANGFUSE_TRACE_PARENT,
			},
		});

		expect(executionRuntime.createRun).toHaveBeenCalledOnce();
		const createRunInput = (executionRuntime.createRun as ReturnType<typeof vi.fn>).mock
			.calls[0]?.[0];
		const metadata = createRunInput?.metadata as Record<string, unknown>;
		const executionPayload = metadata.execution_payload as Record<string, unknown>;
		expect(Object.keys(executionPayload).sort()).toEqual([
			"actor",
			"context",
			"conversation_id",
			"effective_tool",
			"execution_contract_version",
			"request_id",
			"requested_scope",
			"requested_tool",
			"response_contract",
			"safety_identifier",
			"task_queue",
			"tenant_id",
			"trace",
			"user_goal",
			"version_query",
		]);
		expect(executionPayload).toMatchObject({
			execution_contract_version: "tool_execution_v1",
			response_contract: "execution_finalization_response_v2",
			effective_tool: "knowledge_query",
			task_queue: "campus-agent.workflow",
			requested_tool: "knowledge_query",
			tenant_id: "tenant-main",
			trace: {
				trace_id: "trace_0001",
			},
			user_goal: "示例大学本科学生国家奖学金评审办法",
			version_query: {
				mode: "current",
			},
		});
		expect(executionPayload.runtime_decisions).toBeUndefined();
		expect(metadata.handoff).toBeUndefined();
		expect(executionRuntime.createRun).toHaveBeenCalledWith({
			conversationId: "conv_01HQ",
			taskQueue: "campus-agent.workflow",
			metadata: expect.objectContaining({
				execution_payload: expect.objectContaining({
					actor: expect.objectContaining({
						user_id: "user_01HQ",
					}),
					context: expect.any(Object),
					conversation_id: "conv_01HQ",
					task_queue: "campus-agent.workflow",
					request_id: "req_0001",
					requested_tool: "knowledge_query",
					requested_scope: {
						collection: "student_rules",
						corpus: "regulations",
					},
					safety_identifier: expect.any(String),
					tenant_id: "tenant-main",
					trace: {
						trace_id: "trace_0001",
					},
					user_goal: "示例大学本科学生国家奖学金评审办法",
					version_query: {
						mode: "current",
					},
				}),
			}),
			ownerUserId: "user_01HQ",
			requestId: "req_0001",
			requestedTool: "knowledge_query",
			runId: "run_0001",
			runtimeVersions: {
				contract: "durable-agent-runtime-contract-v1",
			},
			selectedTool: "knowledge_query",
			surface: "campus_web",
			traceHeaders: {
				baggage: "release=2026.06.18",
				sentryTrace: "fedcba9876543210fedcba9876543210-0123456789abcdef-1",
				traceParent: EXPECTED_LANGFUSE_TRACE_PARENT,
			},
			traceId: "trace_0001",
			turnId: "turn_0001",
		});
		expect(metadata).not.toHaveProperty("handoff");
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
		expect(executionClient.execute).not.toHaveBeenCalled();
		expect(executionRuntime.listRunEvents).toHaveBeenCalledWith({
			afterSequence: 0,
			runId: "run_0001",
			traceHeaders: {
				baggage: "release=2026.06.18",
				sentryTrace: "fedcba9876543210fedcba9876543210-0123456789abcdef-1",
				traceParent: EXPECTED_LANGFUSE_TRACE_PARENT,
			},
			traceId: "trace_0001",
			waitMs: DEFAULT_DURABLE_EVENT_POLLING_POLICY.waitMs,
		});
		expect(response).toMatchObject({
			answer: {
				result: {
					kind: "answer",
					text: "国家奖学金每学年评审一次。",
				},
			},
			requestId: "req_0001",
			traceId: "trace_0001",
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
				.mockResolvedValueOnce([
					durableEvent({
						eventType: "run.failed",
						payload: {
							error: {
								code: "agent_runtime_timeout",
								message: "Agent runtime request timed out.",
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
				])
				.mockResolvedValue([]),
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
			payload: { conversationId: "conv_01HQ", prompt: "校园卡丢了怎么办" },
			principal: createPrincipal(),
			surface: "campus_web",
		});

		expect(response.answer.result).toMatchObject({
			errorCode: "agent_runtime_timeout",
			kind: "error",
			message: "Agent runtime request timed out.",
			requestId: "req_0001",
			retryable: true,
			traceId: "trace_0001",
		});
		expect(finalWrites).toHaveLength(1);
		expect(finalWrites[0]).toMatchObject({
			requestExecution: {
				requestId: "req_0001",
				runId: "run_0001",
				status: "error",
			},
		});
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
				requestId: "req_0001",
				requestedTool: "knowledge_query",
				runId: "run_0001",
				selectedTool: "knowledge_query",
				startedAt: "",
				status: "queued",
				streamingStartedAt: "",
				surface: "campus_web",
				taskQueue: "campus-agent.workflow",
				terminalReason: "",
				traceId: "trace_0001",
				turnId: "turn_0001",
				updatedAt: "2026-06-04T01:02:04Z",
				workflowPlanRef: "",
			}),
			getRun: vi.fn(),
			listRunEvents: vi.fn().mockResolvedValue([
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
				requestedTool: "knowledge_query",
			},
			principal: createPrincipal(),
			surface: "campus_web",
		});

		const langfuseTraceId = deriveLangfuseTraceId("trace_0001");
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

	it("admits campus services requests into durable execution without local tool preplanning", async () => {
		const { store, acceptedWrites, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const telemetry = createTelemetryMock();
		const executionClient: ToolExecutionClient = {
			execute: vi.fn(),
		};
		const executionRuntime: ExecutionControlRuntimeClient = {
			cancelRun: vi.fn(),
			createRun: vi.fn().mockResolvedValue(
				durableRun({
					requestedTool: "transport_schedule_lookup",
					selectedTool: "transport_schedule_lookup",
				}),
			),
			getRun: vi.fn(),
			listRunEvents: vi.fn().mockResolvedValue([
				durableEvent({
					eventId: "event-final",
					eventType: "finalization.completed",
					payload: {
						request_id: "req_0001",
						response: {
							...answerResponsePayload("图书馆开放状态会由校园服务能力查询。"),
							selected_tool: "transport_schedule_lookup",
						},
						trace_id: "trace_0001",
					},
					sequence: 1,
					visibility: "internal",
				}),
			]),
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

		const response = await service.submit({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "海淀校区图书馆现在开门吗？",
				requestedTool: "transport_schedule_lookup",
			},
			principal: createPrincipal(),
			surface: "campus_web",
		});

		expect(executionRuntime.createRun).toHaveBeenCalledOnce();
		const createRunInput = (executionRuntime.createRun as ReturnType<typeof vi.fn>).mock
			.calls[0]?.[0];
		expect(createRunInput).toMatchObject({
			taskQueue: "campus-agent.workflow",
			requestedTool: "transport_schedule_lookup",
			selectedTool: "transport_schedule_lookup",
		});
		const metadata = createRunInput?.metadata as Record<string, unknown>;
		const executionPayload = metadata.execution_payload as Record<string, unknown>;
		expect(executionPayload).toMatchObject({
			effective_tool: "transport_schedule_lookup",
			task_queue: "campus-agent.workflow",
			requested_tool: "transport_schedule_lookup",
			user_goal: "海淀校区图书馆现在开门吗？",
		});
		expect(executionPayload.runtime_decisions).toBeUndefined();
		expect(metadata).not.toHaveProperty("handoff");
		expect(JSON.stringify(metadata)).not.toContain("selected_tool");
		expect(JSON.stringify(metadata)).not.toContain("allowed_tools");
		expect(executionClient.execute).not.toHaveBeenCalled();
		expect(acceptedWrites).toHaveLength(1);
		expect(finalWrites).toHaveLength(1);
		expect(response.answer.result).toMatchObject({
			kind: "answer",
			text: "图书馆开放状态会由校园服务能力查询。",
		});
	});

	it("keeps omitted requested tool unset for plan.route instead of defaulting to knowledge", async () => {
		const { store } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const executionRuntime: ExecutionControlRuntimeClient = {
			cancelRun: vi.fn(),
			createRun: vi.fn().mockResolvedValue(
				durableRun({
					taskQueue: "campus-agent.workflow",
					requestedTool: "",
					selectedTool: "",
				}),
			),
			getRun: vi.fn(),
			listRunEvents: vi.fn().mockResolvedValue([
				durableEvent({
					eventId: "event-final",
					eventType: "finalization.completed",
					payload: {
						request_id: "req_0001",
						response: {
							...answerResponsePayload("图书馆在海淀校区主教学区西侧。"),
							selected_tool: "place_lookup",
						},
						trace_id: "trace_0001",
					},
					sequence: 1,
					visibility: "internal",
				}),
			]),
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
			surface: "campus_web",
		});

		expect(executionRuntime.createRun).toHaveBeenCalledOnce();
		const createRunInput = (executionRuntime.createRun as ReturnType<typeof vi.fn>).mock
			.calls[0]?.[0];
		expect(createRunInput).toMatchObject({
			taskQueue: "campus-agent.workflow",
			requestedTool: null,
			selectedTool: null,
		});
		const metadata = createRunInput?.metadata as Record<string, unknown>;
		const executionPayload = metadata.execution_payload as Record<string, unknown>;
		expect(executionPayload).not.toHaveProperty("effective_tool");
		expect(executionPayload).not.toHaveProperty("requested_tool");
		expect(executionPayload).toMatchObject({
			task_queue: "campus-agent.workflow",
			user_goal: "图书馆在哪里",
		});
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
			.mockResolvedValueOnce([
				durableEvent({
					eventType: "run.queued",
					payload: { status: "queued" },
					sequence: 1,
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
					sequence: 2,
					visibility: "internal",
				}),
			]);
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

		const response = await service.submit({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "示例大学本科学生国家奖学金评审办法",
				requestedTool: "knowledge_query",
			},
			principal: createPrincipal(),
			surface: "campus_web",
		});

		expect(executionClient.execute).not.toHaveBeenCalled();
		expect(listRunEvents).toHaveBeenNthCalledWith(1, {
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
		expect(listRunEvents).toHaveBeenNthCalledWith(2, {
			afterSequence: 1,
			runId: "run_0001",
			traceHeaders: {
				baggage: "sentry-environment=test",
				sentryTrace: "0123456789abcdef0123456789abcdef-0123456789abcdef-1",
				traceParent: EXPECTED_LANGFUSE_TRACE_PARENT,
			},
			traceId: "trace_0001",
			waitMs: DEFAULT_DURABLE_EVENT_POLLING_POLICY.waitMs,
		});
		expect(finalWrites[0]).toMatchObject({
			requestExecution: {
				requestId: "req_0001",
				runId: "run_0001",
				status: "completed",
			},
		});
		expect(response.answer.result).toMatchObject({
			kind: "answer",
			text: "国家奖学金每学年评审一次。",
		});
	});
});
