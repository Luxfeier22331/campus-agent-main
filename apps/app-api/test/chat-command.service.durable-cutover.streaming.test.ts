// @vitest-environment node

import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { ExecutionControlRuntimeClient } from "../src/modules/integration/execution-control";
import { ExecutionControlTransportError } from "../src/modules/integration/execution-control";
import type { ChatCommandStreamEvent } from "../src/modules/runtime-command";
import { DEFAULT_DURABLE_EVENT_POLLING_POLICY } from "../src/modules/runtime-command/service/durable";
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
	type ToolExecutionClient,
} from "./chat-command.service.test-support";

const EXPECTED_LANGFUSE_TRACE_PARENT = "00-5f8392c82813604cd79a0f7eb8b7306a-0000000000000001-01";

describe("chat command durable runtime cutover failure and streaming", () => {
	it("keeps both frozen inputs recoverable when inline admission cannot be claimed", async () => {
		const { store, acceptedWrites, finalWrites, frozenAdmissions } = createCommandStore();
		store.claimAdmission = vi.fn(async () => false);
		const { store: conversationStore } = createConversationStore();
		const createRun = vi.fn();
		const service = buildChatCommandService({
			deriveSafetyIdentifier: () => "safety_0001",
			executionRuntime: {
				cancelRun: vi.fn(),
				createRun,
				getRun: vi.fn(),
				listRunEvents: vi.fn(),
				listRunSteps: vi.fn().mockResolvedValue(emptyRunStepTrajectory()),
			},
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-06-04T01:02:03.000Z"),
			conversationStore,
			store,
		});

		await expect(
			service.submit({
				payload: {
					conversationId: "conv_01HQ",
					prompt: "图书馆开放到几点？",
				},
				principal: createPrincipal(),
				requestKind: "public_chat",
			}),
		).rejects.toMatchObject({
			code: "admission_pending",
			retryable: true,
			status: 503,
		});
		expect(createRun).not.toHaveBeenCalled();
		expect(acceptedWrites).toHaveLength(1);
		expect(finalWrites).toHaveLength(0);
		expect(frozenAdmissions).toHaveLength(1);
		const frozen = frozenAdmissions[0];
		expect(frozen).toBeDefined();
		expect(frozen?.admissionInputSha256).toBe(
			createHash("sha256")
				.update(frozen?.admissionInputJson ?? "", "utf8")
				.digest("hex"),
		);
		expect(frozen?.executionInputSha256).toBe(
			createHash("sha256")
				.update(frozen?.executionInputJson ?? "", "utf8")
				.digest("hex"),
		);
		store.listPendingAdmissions = vi.fn(async () => [
			{
				admissionInputJson: frozen?.admissionInputJson ?? "",
				admissionInputSha256: frozen?.admissionInputSha256 ?? "",
				requestId: "req_0001",
				runId: "run_0001",
				workflowId: frozen?.workflowId ?? "",
			},
		]);
		await expect(store.listPendingAdmissions()).resolves.toHaveLength(1);
	});

	it("claims before closing a corrupted frozen admission as a deterministic product failure", async () => {
		const { store, finalWrites } = createCommandStore();
		const acceptRequest = store.acceptRequest.bind(store);
		store.acceptRequest = vi.fn(async (input) => {
			const accepted = await acceptRequest(input);
			return {
				...accepted,
				frozenAdmission: {
					...accepted.frozenAdmission,
					admissionInputSha256: "0".repeat(64),
				},
			};
		});
		const { store: conversationStore } = createConversationStore();
		const createRun = vi.fn();
		const service = buildChatCommandService({
			conversationStore,
			executionRuntime: {
				cancelRun: vi.fn(),
				createRun,
				getRun: vi.fn(),
				listRunEvents: vi.fn(),
				listRunSteps: vi.fn().mockResolvedValue(emptyRunStepTrajectory()),
			},
			generateId: createDeterministicIdGenerator(),
			store,
		});

		await expect(
			service.submit({
				payload: { conversationId: "conv_01HQ", prompt: "图书馆开放到几点？" },
				principal: createPrincipal(),
			}),
		).resolves.toMatchObject({ answer: { result: { kind: "error", retryable: false } } });
		expect(store.claimAdmission).toHaveBeenCalledWith(
			expect.objectContaining({
				requestId: "req_0001",
				workflowId: "campus-agent.chat.run_0001",
			}),
		);
		expect(createRun).not.toHaveBeenCalled();
		expect(finalWrites[0]).toMatchObject({
			admissionFailure: { workflowId: "campus-agent.chat.run_0001" },
			turnDispatch: { status: "error" },
		});
	});

	it("atomically closes a background deterministic admission failure through the product service", async () => {
		const { store, finalWrites, frozenAdmissions } = createCommandStore();
		store.claimAdmission = vi
			.fn(async () => true)
			.mockResolvedValueOnce(false)
			.mockResolvedValueOnce(true);
		const { store: conversationStore } = createConversationStore();
		const createRun = vi.fn().mockRejectedValue(
			new ExecutionControlTransportError({
				code: "invalid_request",
				message: "Invalid admission input.",
				retryable: false,
				status: 400,
			}),
		);
		const service = buildChatCommandService({
			deriveSafetyIdentifier: () => "safety_0001",
			executionRuntime: {
				cancelRun: vi.fn(),
				createRun,
				getRun: vi.fn(),
				listRunEvents: vi.fn(),
				listRunSteps: vi.fn().mockResolvedValue(emptyRunStepTrajectory()),
			},
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-06-04T01:02:03.000Z"),
			conversationStore,
			store,
		});

		await expect(
			service.submit({
				payload: {
					conversationId: "conv_01HQ",
					prompt: "图书馆开放到几点？",
				},
				principal: createPrincipal(),
				requestKind: "public_chat",
			}),
		).rejects.toMatchObject({ code: "admission_pending" });
		const frozen = frozenAdmissions[0];
		expect(frozen).toBeDefined();
		store.listPendingAdmissions = vi.fn(async () => [
			{
				admissionInputJson: frozen?.admissionInputJson ?? "",
				admissionInputSha256: frozen?.admissionInputSha256 ?? "",
				requestId: "req_0001",
				runId: "run_0001",
				workflowId: "campus-agent.chat.run_0001",
			},
		]);

		await expect(service.dispatchPendingAdmissions?.()).resolves.toEqual({
			admitted: 0,
			failed: 1,
			processed: 1,
		});
		expect(finalWrites[0]).toMatchObject({
			admissionFailure: { workflowId: "campus-agent.chat.run_0001" },
			assistantMessage: { kind: "error", retryable: false },
			requestObservabilityFact: { errorCode: "invalid_request", status: "error" },
			turnDispatch: { errorCode: "invalid_request", status: "error" },
		});
		expect(finalWrites[0]?.finalizationFingerprint).toMatch(/^[a-f0-9]{64}$/u);
		expect(store.releaseAdmission).not.toHaveBeenCalled();
	});

	it("keeps the accepted request pending when the dispatch claim fence is lost", async () => {
		const { store, acceptedWrites, finalWrites } = createCommandStore();
		store.claimAdmission = vi.fn(async () => false);
		const { store: conversationStore } = createConversationStore();
		const createRun = vi.fn();
		const service = buildChatCommandService({
			deriveSafetyIdentifier: () => "safety_0001",
			executionRuntime: {
				cancelRun: vi.fn(),
				createRun,
				getRun: vi.fn(),
				listRunEvents: vi.fn(),
				listRunSteps: vi.fn().mockResolvedValue(emptyRunStepTrajectory()),
			},
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-06-04T01:02:03.000Z"),
			conversationStore,
			store,
		});

		await expect(
			service.submit({
				payload: {
					conversationId: "conv_01HQ",
					prompt: "图书馆开放到几点？",
				},
				principal: createPrincipal(),
				requestKind: "public_chat",
			}),
		).rejects.toMatchObject({
			code: "admission_pending",
			retryable: true,
			status: 503,
		});
		expect(createRun).not.toHaveBeenCalled();
		expect(acceptedWrites).toHaveLength(1);
		expect(finalWrites).toHaveLength(0);
	});

	it("keeps the accepted request pending when the post-create admission fence is lost", async () => {
		const { store, acceptedWrites, finalWrites } = createCommandStore();
		store.markAdmitted = vi.fn(async () => false);
		const { store: conversationStore } = createConversationStore();
		const createRun = vi.fn(async () => durableRun());
		const service = buildChatCommandService({
			deriveSafetyIdentifier: () => "safety_0001",
			executionRuntime: {
				cancelRun: vi.fn(),
				createRun,
				getRun: vi.fn(),
				listRunEvents: vi.fn(),
				listRunSteps: vi.fn().mockResolvedValue(emptyRunStepTrajectory()),
			},
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-06-04T01:02:03.000Z"),
			conversationStore,
			store,
		});

		await expect(
			service.submit({
				payload: {
					conversationId: "conv_01HQ",
					prompt: "图书馆开放到几点？",
				},
				principal: createPrincipal(),
				requestKind: "public_chat",
			}),
		).rejects.toMatchObject({
			code: "admission_pending",
			retryable: true,
			status: 503,
		});
		expect(createRun).toHaveBeenCalledOnce();
		expect(store.releaseAdmission).toHaveBeenCalledOnce();
		expect(acceptedWrites).toHaveLength(1);
		expect(finalWrites).toHaveLength(0);
	});

	it("reads back product finalization when it wins the admission mark race", async () => {
		const { store, finalWrites } = createCommandStore();
		store.markAdmitted = vi.fn(async () => false);
		store.readExecutionInput = vi.fn(async (runId) =>
			finalWrites.length > 0
				? {
						executionInputJson: '{"request_id":"req_0001"}',
						executionInputSha256: "b".repeat(64),
						requestId: "req_0001",
						runId,
						status: "completed" as const,
					}
				: null,
		);
		const { store: conversationStore } = createConversationStore();
		const productResponse = {
			answerText: "国家奖学金每学年评审一次。",
			error: null,
			followUpQuestion: "",
			modelUsage: { cachedInputTokens: 10, inputTokens: 120, outputTokens: 42, totalTokens: 162 },
			result: null,
			status: "completed" as const,
			traceId: "trace_0001",
		};
		let service: ReturnType<typeof buildChatCommandService>;
		const createRun = vi.fn(async () => {
			await service.applyProductFinalization?.({
				completedAt: "2026-06-04T01:02:06.000Z",
				finalizationFingerprint: "test:run_0001",
				response: productResponse,
				runId: "run_0001",
			});
			return durableRun();
		});
		const executionRuntime: ExecutionControlRuntimeClient = {
			cancelRun: vi.fn(),
			createRun,
			getRun: vi.fn(async () => durableRun()),
			listRunEvents: vi.fn(async () => ({
				events: [
					durableEvent({
						eventType: "finalization.completed",
						occurredAt: "2026-06-04T01:02:06.000Z",
						payload: {
							request_id: "req_0001",
							response: answerResponsePayload(),
							trace_id: "trace_0001",
						},
						sequence: 1,
						visibility: "internal",
					}),
				],
				nextSequence: 1,
			})),
			listRunSteps: vi.fn().mockResolvedValue(emptyRunStepTrajectory()),
		};
		service = buildChatCommandService({
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
				prompt: "图书馆开放到几点？",
			},
			principal: createPrincipal(),
			requestKind: "public_chat",
		});

		expect(response.answer.result.kind).toBe("answer");
		expect(store.markAdmitted).toHaveBeenCalledTimes(2);
		expect(store.readExecutionInput).toHaveBeenCalledWith("run_0001");
		expect(store.releaseAdmission).not.toHaveBeenCalled();
		expect(finalWrites.length).toBeGreaterThanOrEqual(1);
	});

	it("repairs the post-create admission fence before entering durable blocking", async () => {
		const { store, acceptedWrites, finalWrites } = createCommandStore();
		store.markAdmitted = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
		const { store: conversationStore } = createConversationStore();
		const createRun = vi.fn(async () => durableRun());
		const getRun = vi.fn(async () => durableRun());
		const executionRuntime: ExecutionControlRuntimeClient = {
			cancelRun: vi.fn(),
			createRun,
			getRun,
			listRunEvents: vi.fn().mockResolvedValue({ events: [], nextSequence: 0 }),
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

		await expect(
			service.submit({
				payload: {
					conversationId: "conv_01HQ",
					prompt: "图书馆开放到几点？",
				},
				principal: createPrincipal(),
				requestKind: "public_chat",
			}),
		).rejects.toMatchObject({
			code: "execution_status_pending",
			details: { requestId: "req_0001", runId: "run_0001" },
			retryable: true,
			status: 504,
		});
		expect(createRun).toHaveBeenCalledOnce();
		expect(getRun).toHaveBeenCalledOnce();
		expect(store.markAdmitted).toHaveBeenCalledTimes(2);
		expect(store.releaseAdmission).not.toHaveBeenCalled();
		expect(acceptedWrites).toHaveLength(1);
		expect(finalWrites).toHaveLength(0);
	});

	it("recovers a durable run when the create response is lost", async () => {
		const { store, acceptedWrites, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const createRun = vi.fn().mockRejectedValue(
			new ExecutionControlTransportError({
				code: "execution_timeout",
				message: "Execution control timed out.",
				retryable: true,
				status: 504,
			}),
		);
		const getRun = vi.fn(async () => durableRun());
		const executionRuntime: ExecutionControlRuntimeClient = {
			cancelRun: vi.fn(),
			createRun,
			getRun,
			listRunEvents: vi.fn().mockResolvedValue({ events: [], nextSequence: 0 }),
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

		await expect(
			service.submit({
				payload: {
					conversationId: "conv_01HQ",
					prompt: "图书馆开放到几点？",
				},
				principal: createPrincipal(),
				requestKind: "public_chat",
			}),
		).rejects.toMatchObject({
			code: "execution_status_pending",
			details: { requestId: "req_0001", runId: "run_0001" },
			retryable: true,
			status: 504,
		});
		expect(createRun).toHaveBeenCalledOnce();
		expect(getRun).toHaveBeenCalledOnce();
		expect(store.markAdmitted).toHaveBeenCalledOnce();
		expect(store.releaseAdmission).not.toHaveBeenCalled();
		expect(acceptedWrites).toHaveLength(1);
		expect(finalWrites).toHaveLength(0);
	});

	it("finalizes deterministic admission conflicts even when the transport marks them retryable", async () => {
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
				prompt: "示例大学本科学生国家奖学金评审办法",
			},
			principal: createPrincipal(),
			requestKind: "public_chat",
		});

		expect(response.answer.result).toMatchObject({
			errorCode: "internal_error",
			kind: "error",
			retryable: false,
		});
		expect(acceptedWrites[0]).toMatchObject({
			turnDispatch: {
				requestId: "req_0001",
				runId: "run_0001",
				status: "accepted",
			},
		});
		expect(executionClient.execute).not.toHaveBeenCalled();
		expect(store.releaseAdmission).not.toHaveBeenCalled();
		expect(finalWrites[0]).toMatchObject({
			admissionFailure: { workflowId: "campus-agent.chat.run_0001" },
			turnDispatch: { errorCode: "internal_error", status: "error" },
		});
		expect(finalWrites[0]?.finalizationFingerprint).toMatch(/^[a-f0-9]{64}$/u);
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
					message: "metadata.execution_input_ref must match run_id",
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
				prompt: "示例大学本科学生国家奖学金评审办法",
			},
			principal: createPrincipal(),
			requestKind: "public_chat",
		}) ?? []) {
			events.push(event);
		}

		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			data: {
				error: {
					code: "invalid_request",
					message: "The request could not be completed.",
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
			turnDispatch: {
				requestId: "req_0001",
				runId: "run_0001",
				status: "accepted",
			},
		});
		expect(finalWrites[0]).toMatchObject({
			admissionFailure: { workflowId: "campus-agent.chat.run_0001" },
			turnDispatch: {
				errorCode: "invalid_request",
				requestId: "req_0001",
				runId: "run_0001",
				status: "error",
			},
		});
		expect(finalWrites[0]?.finalizationFingerprint).toMatch(/^[a-f0-9]{64}$/u);
		expect(store.releaseAdmission).not.toHaveBeenCalled();
		expect(executionClient.executeStream).not.toHaveBeenCalled();
		expect(executionRuntime.listRunEvents).not.toHaveBeenCalled();
	});

	it("emits only the accepted state while pending admission remains durable", async () => {
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
			requestKind: "public_chat",
		}) ?? []) {
			events.push(event);
		}

		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			data: {
				requestId: "req_0001",
				runId: "run_0001",
				status: "accepted",
			},
			event: "request.accepted",
		});
		expect(finalWrites).toHaveLength(0);
	});

	it("leaves blocking durable requests resumable when the polling budget expires", async () => {
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
				queuedAt: "2026-06-04T01:02:03Z",
				requestId: "req_0001",
				runId: "run_0001",
				startedAt: "",
				status: "queued",
				streamingStartedAt: "",
				surface: "campus_web",
				terminalReason: "",
				traceId: "trace_0001",
				turnId: "turn_0001",
				updatedAt: "2026-06-04T01:02:04Z",
			}),
			getRun: vi.fn(),
			listRunEvents: vi
				.fn()
				.mockResolvedValueOnce(
					durableEventPage([
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
					]),
				)
				.mockResolvedValueOnce(durableEventPage([], 1)),
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
			code: "execution_status_pending",
			details: { requestId: "req_0001", runId: "run_0001" },
			retryable: true,
			status: 504,
		});

		expect(executionClient.execute).not.toHaveBeenCalled();
		expect(finalWrites).toHaveLength(0);
	});

	it("streams durable run events and finalizes from finalization completed event", async () => {
		const { store, acceptedWrites, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const telemetry = createTelemetryMock();
		const now = vi
			.fn<() => Date>()
			.mockReturnValueOnce(new Date("2026-06-04T01:02:03.000Z"))
			.mockReturnValue(new Date("2026-06-04T01:02:07.000Z"));
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
				queuedAt: "2026-06-04T01:02:03Z",
				requestId: "req_0001",
				runId: "run_0001",
				startedAt: "",
				status: "queued",
				streamingStartedAt: "",
				surface: "campus_web",
				terminalReason: "",
				traceId: "trace_0001",
				turnId: "turn_0001",
				updatedAt: "2026-06-04T01:02:04Z",
			}),
			getRun: vi.fn(),
			listRunEvents: vi
				.fn()
				.mockResolvedValueOnce(
					durableEventPage([
						durableEvent({
							eventId: "event-queued",
							eventType: "run.queued",
							occurredAt: "2026-06-04T01:02:03.200Z",
							payload: { status: "queued" },
							sequence: 1,
							visibility: "internal",
						}),
						durableEvent({
							eventId: "event-started",
							eventType: "run.started",
							occurredAt: "2026-06-04T01:02:03.500Z",
							payload: { status: "running" },
							sequence: 2,
							visibility: "internal",
						}),
					]),
				)
				.mockResolvedValueOnce(
					durableEventPage([
						durableEvent({
							eventId: "event-answer-delta",
							eventType: "run.answer_delta",
							occurredAt: "2026-06-04T01:02:04.000Z",
							payload: {
								chunk_index: 1,
								delta: "国家奖学金每学年评审一次。",
								message_id: "msg_answer",
								request_id: "req_0001",
								trace_id: "trace_0001",
							},
							payloadSchemaVersion: "run-answer-event-v2",
							sequence: 3,
							visibility: "browser",
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
								response: {
									...answerResponsePayload(),
									stage_timing: { "agent.first_delta_ms": 3000 },
								},
								trace_id: "trace_0001",
							},
							sequence: 4,
							visibility: "internal",
						}),
					]),
				),
			listRunSteps: vi.fn().mockResolvedValue(emptyRunStepTrajectory()),
		};
		const service = buildChatCommandService({
			deriveSafetyIdentifier: () => "safety_0001",
			durableEventPolling: {
				maxAttempts: 2,
			},
			executionRuntime,
			generateId: createDeterministicIdGenerator(),
			now,
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
				prompt: "示例大学本科学生国家奖学金评审办法",
			},
			principal: createPrincipal(),
			requestKind: "public_chat",
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
				traceParent: EXPECTED_LANGFUSE_TRACE_PARENT,
			},
			traceId: "trace_0001",
			waitMs: DEFAULT_DURABLE_EVENT_POLLING_POLICY.waitMs,
		});
		expect(executionRuntime.listRunEvents).toHaveBeenCalledWith({
			afterSequence: 2,
			runId: "run_0001",
			traceHeaders: {
				traceParent: EXPECTED_LANGFUSE_TRACE_PARENT,
			},
			traceId: "trace_0001",
			waitMs: DEFAULT_DURABLE_EVENT_POLLING_POLICY.waitMs,
		});
		expect(executionRuntime.listRunEvents).toHaveBeenCalledWith({
			afterSequence: 3,
			runId: "run_0001",
			traceHeaders: {
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
			turnDispatch: {
				requestId: "req_0001",
				runId: "run_0001",
				status: "accepted",
			},
		});
		expect(finalWrites).toHaveLength(1);
		expect(finalWrites[0]).toMatchObject({
			requestObservabilityFact: {
				stageTiming: {
					"agent.first_delta_ms": 3000,
					"stream.app_api_ttft_ms": 4000,
					"stream.orchestration_overhead_ms": 1000,
				},
			},
			turnDispatch: {
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
				queuedAt: "2026-06-04T01:02:03Z",
				requestId: "req_0001",
				runId: "run_0001",
				startedAt: "",
				taskQueue: "campus-agent.workflow",
				status: "queued",
				streamingStartedAt: "",
				surface: "campus_web",
				terminalReason: "",
				traceId: "trace_0001",
				turnId: "turn_0001",
				updatedAt: "2026-06-04T01:02:04Z",
			}),
			getRun: vi.fn(),
			listRunEvents: vi
				.fn()
				.mockResolvedValueOnce(
					durableEventPage([
						durableEvent({
							eventId: "event-queued",
							eventType: "run.queued",
							occurredAt: "2026-06-04T01:02:04.000Z",
							payload: { status: "queued" },
							sequence: 1,
							visibility: "browser",
						}),
					]),
				)
				.mockResolvedValueOnce(
					durableEventPage([
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
				),
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
		});

		const events: Array<{ event: string; status: string }> = [];
		for await (const event of service.submitStream?.({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "示例大学本科学生国家奖学金评审办法",
			},
			principal: createPrincipal(),
			requestKind: "public_chat",
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
		expect(finalWrites).toHaveLength(1);
		expect(finalWrites[0]).toMatchObject({
			turnDispatch: {
				errorCode: "execution_cancelled",
				requestId: "req_0001",
				runId: "run_0001",
				status: "cancelled",
			},
		});
	});
});
