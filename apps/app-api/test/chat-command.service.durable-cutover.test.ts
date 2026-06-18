// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import type { ExecutionControlRuntimeClient } from "../src/modules/integration/execution-control";
import { ExecutionControlTransportError } from "../src/modules/integration/execution-control";
import { DEFAULT_DURABLE_EVENT_POLLING_POLICY } from "../src/modules/runtime-command/service/durable";
import {
	answerResponsePayload,
	durableEvent,
	durableRun,
	emptyRunStepTrajectory,
} from "./chat-command.service.durable-cutover.test-support";
import {
	buildChatCommandService,
	type CapabilityExecutionClient,
	createCommandStore,
	createConversationStore,
	createDeterministicIdGenerator,
	createPrincipal,
	createTelemetryMock,
} from "./chat-command.service.test-support";

describe("chat command durable runtime cutover", () => {
	it("rejects blocking deployed chat commands when durable runtime is required but missing", async () => {
		const { store, acceptedWrites, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const supervisor: CapabilityExecutionClient = {
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
					prompt: "中央民族大学本科学生国家奖学金评审办法",
					requestedCapability: "knowledge",
				},
				principal: createPrincipal(),
				surface: "public_chat_web",
			}),
		).rejects.toMatchObject({
			code: "execution_runtime_required",
			retryable: true,
			status: 503,
		});

		expect(acceptedWrites).toHaveLength(0);
		expect(finalWrites).toHaveLength(0);
		expect(supervisor.execute).not.toHaveBeenCalled();
	});

	it("rejects streaming deployed chat commands when durable runtime is required but missing", async () => {
		const { store, acceptedWrites, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const supervisor: CapabilityExecutionClient = {
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
					prompt: "中央民族大学本科学生国家奖学金评审办法",
					requestedCapability: "knowledge",
				},
				principal: createPrincipal(),
				surface: "public_chat_web",
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
		expect(supervisor.execute).not.toHaveBeenCalled();
		expect(supervisor.executeStream).not.toHaveBeenCalled();
	});

	it("rejects blocking deployed chat commands before accept when required durable config is absent", async () => {
		const { store, acceptedWrites, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const supervisor: CapabilityExecutionClient = {
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
					prompt: "中央民族大学本科学生国家奖学金评审办法",
					requestedCapability: "knowledge",
				},
				principal: createPrincipal(),
				surface: "public_chat_web",
			}),
		).rejects.toMatchObject({
			code: "execution_runtime_required",
			retryable: true,
			status: 503,
		});

		expect(executionRuntime.createRun).not.toHaveBeenCalled();
		expect(acceptedWrites).toHaveLength(0);
		expect(finalWrites).toHaveLength(0);
		expect(supervisor.execute).not.toHaveBeenCalled();
	});

	it("finalizes blocking accepted chat requests from durable finalization events", async () => {
		const { store, acceptedWrites, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const telemetry = createTelemetryMock();
		const supervisor: CapabilityExecutionClient = {
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
							selected_capability: "knowledge",
							status: "completed",
							trace_id: "trace_0001",
						},
					},
					payloadSchemaVersion: "run-event-v1",
					runId: "run_0001",
					sequence: 1,
					visibility: "browser",
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
				prompt: "中央民族大学本科学生国家奖学金评审办法",
				requestedCapability: "knowledge",
				requestedScope: {
					collection: "student_rules",
					corpus: "regulations",
				},
			},
			principal: createPrincipal(),
			surface: "public_chat_web",
			traceHeaders: {
				baggage: "release=2026.06.18",
				sentryTrace: "fedcba9876543210fedcba9876543210-0123456789abcdef-1",
				traceParent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
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
			"effective_capability",
			"execution_contract_version",
			"lane",
			"request_id",
			"requested_capability",
			"requested_scope",
			"response_contract",
			"safety_identifier",
			"tenant_id",
			"trace",
			"user_goal",
			"version_query",
		]);
		expect(executionPayload).toMatchObject({
			execution_contract_version: "capability_execution_v1",
			response_contract: "execution_finalization_response_v1",
			effective_capability: "knowledge",
			lane: "rag",
			requested_capability: "knowledge",
			tenant_id: "tenant-main",
			trace: {
				trace_id: "trace_0001",
			},
			user_goal: "中央民族大学本科学生国家奖学金评审办法",
			version_query: {
				mode: "current",
			},
		});
		expect(executionPayload.runtime_decisions).toBeUndefined();
		expect(metadata.handoff).toBeUndefined();
		expect(executionRuntime.createRun).toHaveBeenCalledWith({
			conversationId: "conv_01HQ",
			lane: "rag",
			metadata: expect.objectContaining({
				execution_payload: expect.objectContaining({
					actor: expect.objectContaining({
						user_id: "user_01HQ",
					}),
					context: expect.any(Object),
					conversation_id: "conv_01HQ",
					lane: "rag",
					request_id: "req_0001",
					requested_capability: "knowledge",
					requested_scope: {
						collection: "student_rules",
						corpus: "regulations",
					},
					safety_identifier: expect.any(String),
					tenant_id: "tenant-main",
					trace: {
						trace_id: "trace_0001",
					},
					user_goal: "中央民族大学本科学生国家奖学金评审办法",
					version_query: {
						mode: "current",
					},
				}),
			}),
			ownerUserId: "user_01HQ",
			requestId: "req_0001",
			requestedCapability: "knowledge",
			runId: "run_0001",
			runtimeVersions: {
				contract: "durable-agent-runtime-contract-v1",
			},
			selectedCapability: "knowledge",
			surface: "public_chat_web",
			traceHeaders: {
				baggage: "release=2026.06.18",
				sentryTrace: "fedcba9876543210fedcba9876543210-0123456789abcdef-1",
				traceParent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
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
		expect(supervisor.execute).not.toHaveBeenCalled();
		expect(executionRuntime.listRunEvents).toHaveBeenCalledWith({
			afterSequence: 0,
			runId: "run_0001",
			traceHeaders: {
				baggage: "release=2026.06.18",
				sentryTrace: "fedcba9876543210fedcba9876543210-0123456789abcdef-1",
				traceParent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
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

	it("admits campus services requests into durable execution without local tool preplanning", async () => {
		const { store, acceptedWrites, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const telemetry = createTelemetryMock();
		const supervisor: CapabilityExecutionClient = {
			execute: vi.fn(),
		};
		const executionRuntime: ExecutionControlRuntimeClient = {
			cancelRun: vi.fn(),
			createRun: vi.fn().mockResolvedValue(
				durableRun({
					lane: "campus_services",
					requestedCapability: "campus_services",
					selectedCapability: "campus_services",
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
							selected_capability: "campus_services",
						},
						trace_id: "trace_0001",
					},
					sequence: 1,
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
				requestedCapability: "campus_services",
			},
			principal: createPrincipal(),
			surface: "public_chat_web",
		});

		expect(executionRuntime.createRun).toHaveBeenCalledOnce();
		const createRunInput = (executionRuntime.createRun as ReturnType<typeof vi.fn>).mock
			.calls[0]?.[0];
		expect(createRunInput).toMatchObject({
			lane: "campus_services",
			requestedCapability: "campus_services",
			selectedCapability: "campus_services",
		});
		const metadata = createRunInput?.metadata as Record<string, unknown>;
		const executionPayload = metadata.execution_payload as Record<string, unknown>;
		expect(executionPayload).toMatchObject({
			effective_capability: "campus_services",
			lane: "campus_services",
			requested_capability: "campus_services",
			user_goal: "海淀校区图书馆现在开门吗？",
		});
		expect(executionPayload.runtime_decisions).toBeUndefined();
		expect(metadata).not.toHaveProperty("handoff");
		expect(JSON.stringify(metadata)).not.toContain("selected_tool");
		expect(JSON.stringify(metadata)).not.toContain("allowed_tools");
		expect(supervisor.execute).not.toHaveBeenCalled();
		expect(acceptedWrites).toHaveLength(1);
		expect(finalWrites).toHaveLength(1);
		expect(response.answer.result).toMatchObject({
			kind: "answer",
			text: "图书馆开放状态会由校园服务能力查询。",
		});
	});

	it("keeps omitted requested capability unset for plan.route instead of defaulting to knowledge", async () => {
		const { store } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const executionRuntime: ExecutionControlRuntimeClient = {
			cancelRun: vi.fn(),
			createRun: vi.fn().mockResolvedValue(
				durableRun({
					lane: "default",
					requestedCapability: "",
					selectedCapability: "",
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
							selected_capability: "navigation",
						},
						trace_id: "trace_0001",
					},
					sequence: 1,
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
			surface: "public_chat_web",
		});

		expect(executionRuntime.createRun).toHaveBeenCalledOnce();
		const createRunInput = (executionRuntime.createRun as ReturnType<typeof vi.fn>).mock
			.calls[0]?.[0];
		expect(createRunInput).toMatchObject({
			lane: "default",
			requestedCapability: null,
			selectedCapability: null,
		});
		const metadata = createRunInput?.metadata as Record<string, unknown>;
		const executionPayload = metadata.execution_payload as Record<string, unknown>;
		expect(executionPayload).not.toHaveProperty("effective_capability");
		expect(executionPayload).not.toHaveProperty("requested_capability");
		expect(executionPayload).toMatchObject({
			lane: "default",
			user_goal: "图书馆在哪里",
		});
	});

	it("polls blocking durable run events by cursor until terminal finalization arrives", async () => {
		const { store, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const telemetry = createTelemetryMock();
		const supervisor: CapabilityExecutionClient = {
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
				prompt: "中央民族大学本科学生国家奖学金评审办法",
				requestedCapability: "knowledge",
			},
			principal: createPrincipal(),
			surface: "public_chat_web",
		});

		expect(supervisor.execute).not.toHaveBeenCalled();
		expect(listRunEvents).toHaveBeenNthCalledWith(1, {
			afterSequence: 0,
			runId: "run_0001",
			traceHeaders: {
				baggage: "sentry-environment=test",
				sentryTrace: "0123456789abcdef0123456789abcdef-0123456789abcdef-1",
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
