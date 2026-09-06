// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import type { ExecutionControlRuntimeClient } from "../src/modules/integration/execution-control";
import { ExecutionControlTransportError } from "../src/modules/integration/execution-control";
import { lifecycleEventFromDurableRunEvent } from "../src/modules/runtime-command/service/durable";
import { DEFAULT_DURABLE_EVENT_POLLING_POLICY } from "../src/modules/runtime-command/service/durable-polling";
import {
	answerResponsePayload,
	durableEvent,
	durableEventPage,
	durableRun,
} from "./chat-command.service.durable-cutover.test-support";
import {
	buildChatCommandService,
	createCommandStore,
	createConversationStore,
	createDeterministicIdGenerator,
	createPrincipal,
	getFrozenExecutionPayload,
	type ToolExecutionClient,
} from "./chat-command.service.test-support";

describe("chat command durable runtime cutover", () => {
	it("uses only durable finalizing progress as the live finalizing evidence", () => {
		const context = {
			acceptedAt: "2026-06-04T01:02:03.000Z",
			requestId: "req_0001",
		};
		const answerCompleted = durableEvent({
			eventType: "run.answer_completed",
			sequence: 3,
		});
		const finalizingProgress = durableEvent({
			eventType: "run.progress",
			payload: { phase: "finalizing" },
			sequence: 4,
		});

		expect(lifecycleEventFromDurableRunEvent(context, answerCompleted)).toBeNull();
		expect(lifecycleEventFromDurableRunEvent(context, finalizingProgress)).toEqual({
			data: {
				occurredAt: "2026-06-04T01:02:04.000Z",
				phase: "finalizing",
				requestId: "req_0001",
				sequence: 4,
				status: "running",
			},
			event: "execution.phase",
		});
	});

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
				startedAt: "",
				status: "queued",
				streamingStartedAt: "",
				surface: "campus_web",
				taskQueue: "campus-agent.workflow",
				terminalReason: "",
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
							response: answerResponsePayload(),
						},
						payloadSchemaVersion: "run-event-v1",
						requestId: "req_0001",
						sequence: 1,
						visibility: "internal",
					},
				]),
			),
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
				prompt: "示例大学本科学生国家奖学金评审办法",
			},
			principal: createPrincipal(),
			requestKind: "public_chat",
		});

		expect(executionRuntime.createRun).toHaveBeenCalledOnce();
		const createRunInput = (executionRuntime.createRun as ReturnType<typeof vi.fn>).mock
			.calls[0]?.[0];
		const executionPayload = getFrozenExecutionPayload(createRunInput?.requestId ?? "req_0001");
		expect(Object.keys(executionPayload).sort()).toEqual([
			"context",
			"conversation_id",
			"execution_contract_version",
			"request_id",
			"response_contract",
			"safety_identifier",
			"tenant_id",
			"user_goal",
		]);
		expect(executionPayload).toMatchObject({
			execution_contract_version: "tool_execution_v7",
			response_contract: "execution_finalization_response_v9",
			tenant_id: "tenant-main",
			user_goal: "示例大学本科学生国家奖学金评审办法",
		});
		expect(createRunInput).not.toHaveProperty("selectedTool");
		expect(createRunInput).not.toHaveProperty("requestedTool");
		expect(createRunInput).not.toHaveProperty("taskQueue");
		expect(executionRuntime.createRun).toHaveBeenCalledWith(
			expect.objectContaining({
				conversationId: "conv_01HQ",
				metadata: expect.objectContaining({
					execution_contract_version: "tool_execution_v7",
					execution_input_ref: "app-api://execution-inputs/req_0001",
					execution_input_sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
				}),
				ownerUserId: "user_01HQ",
				requestId: "req_0001",
				runtimeVersions: {
					contract: "durable-agent-runtime-contract-v1",
				},
				surface: "campus_web",
			}),
		);
		expect(acceptedWrites[0]).toMatchObject({
			turnDispatch: {
				requestId: "req_0001",
				status: "accepted",
			},
		});
		expect(finalWrites).toHaveLength(1);
		expect(executionClient.execute).not.toHaveBeenCalled();
		expect(executionRuntime.listRunEvents).toHaveBeenCalledWith({
			afterSequence: 0,
			requestId: "req_0001",
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
							},
							sequence: 1,
						}),
					]),
				)
				.mockResolvedValue(durableEventPage([], 1)),
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
		expect(finalWrites[0]?.assistantMessage.text).toBe("本次回答超时，未能完成。");
		expect(executionRuntime.listRunEvents).toHaveBeenCalledTimes(1);
	});

	it("rejects retired client routing hints on public chat", async () => {
		const { store, acceptedWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const executionRuntime: ExecutionControlRuntimeClient = {
			cancelRun: vi.fn(),
			createRun: vi.fn(),
			getRun: vi.fn(),
			listRunEvents: vi.fn(),
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
						},
						sequence: 1,
						visibility: "internal",
					}),
				]),
			),
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
		const executionPayload = getFrozenExecutionPayload(createRunInput?.requestId ?? "req_0001");
		expect(executionPayload).not.toHaveProperty("requested_tool");
		expect(executionPayload).toMatchObject({ user_goal: "图书馆在哪里" });
	});

	it("polls blocking durable run events by cursor until terminal finalization arrives", async () => {
		const { store, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
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
			requestId: "req_0001",
			waitMs: DEFAULT_DURABLE_EVENT_POLLING_POLICY.waitMs,
		});
		expect(listRunEvents).toHaveBeenNthCalledWith(2, {
			afterSequence: 1,
			requestId: "req_0001",
			waitMs: DEFAULT_DURABLE_EVENT_POLLING_POLICY.waitMs,
		});
		expect(finalWrites).toHaveLength(1);
	});
});
