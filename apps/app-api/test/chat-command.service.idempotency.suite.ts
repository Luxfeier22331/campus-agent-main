import { expect, it, vi } from "vitest";

import {
	buildChatCommandService,
	type ChatCommandStore,
	createCommandStore,
	createConversation,
	createConversationStore,
	createDeterministicIdGenerator,
	createExecutionRuntimeFromToolClient,
	createHmac,
	createPrincipal,
	createTelemetryMock,
	DRAFT_CONVERSATION_TITLE,
	deriveSafetyIdentifier,
	ExecutionControlTransportError,
	type ToolExecutionClient,
} from "./chat-command.service.test-support";

export function registerChatCommandServiceIdempotencySuite(): void {
	it("rejects after durable accept when the same safety identifier enters the abuse throttle window", async () => {
		const { store, acceptedWrites, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const telemetry = createTelemetryMock();
		const safetySecret = "phase-i-safety-secret";
		const expectedSafetyIdentifier = createHmac("sha256", safetySecret)
			.update("principal:user_01HQ")
			.digest("hex");
		const getAbuseControlState = vi.fn().mockResolvedValue({
			activeThrottleUntil: "2026-03-28T08:05:00.000Z",
			requestCountLastMinute: 9,
			requestCountLastTenMinutes: 9,
			shouldThrottle: true,
			throttleReason: "requests_per_minute",
		});
		const executionClient: ToolExecutionClient = {
			execute: vi.fn(),
		};
		const service = buildChatCommandService({
			deriveSafetyIdentifier: (principal) => deriveSafetyIdentifier(principal, safetySecret),
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-03-28T08:00:00.000Z"),
			conversationStore,
			store: {
				...store,
				getAbuseControlState,
			} as ChatCommandStore,
			executionRuntime: createExecutionRuntimeFromToolClient(executionClient),
			telemetry,
		});

		const response = await service.submit({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "连续快速提问的第九次请求",
			},
			principal: createPrincipal(),
		});

		expect(acceptedWrites).toHaveLength(1);
		expect(getAbuseControlState).toHaveBeenCalledWith({
			now: "2026-03-28T08:00:00.000Z",
			safetyIdentifier: expectedSafetyIdentifier,
			surface: "campus_web",
		});
		expect(executionClient.execute).not.toHaveBeenCalled();
		expect(response.answer.result).toEqual({
			errorCode: "rate_limit_exceeded",
			kind: "error",
			message: "Too many requests. Please wait a few minutes and try again.",
			requestId: "req_0001",
			retryable: false,
			traceId: "trace_0001",
		});
		expect(finalWrites[0]).toMatchObject({
			turnDispatch: {
				errorCode: "rate_limit_exceeded",
				safetyIdentifier: expectedSafetyIdentifier,
				status: "rejected",
			},
			requestObservabilityFact: {
				errorCode: "rate_limit_exceeded",
				failClosed: true,
				safetyIdentifier: expectedSafetyIdentifier,
				status: "rejected",
			},
		});
		expect(telemetry.recordRequestFinalized).toHaveBeenCalledWith(
			expect.objectContaining({
				errorCode: "rate_limit_exceeded",
				requestId: "req_0001",
				safetyIdentifier: expectedSafetyIdentifier,
				status: "rejected",
			}),
		);
	});

	it("keeps a retryable execution admission failure pending", async () => {
		const { store, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const telemetry = createTelemetryMock();
		const service = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-03-28T08:00:00.000Z"),
			conversationStore,
			store,
			telemetry,
			executionRuntime: createExecutionRuntimeFromToolClient({
				execute: vi.fn().mockRejectedValue(
					new ExecutionControlTransportError({
						code: "execution_timeout",
						message: "Execution timed out.",
						retryable: true,
						status: 504,
					}),
				),
			}),
		});

		await expect(
			service.submit({
				payload: {
					conversationId: "conv_01HQ",
					prompt: "图书馆开放到几点？",
				},
				principal: createPrincipal(),
			}),
		).rejects.toMatchObject({ code: "admission_pending", retryable: true });

		expect(finalWrites).toHaveLength(0);
		expect(telemetry.recordRequestFinalized).not.toHaveBeenCalled();
	});

	it("finalizes unexpected execution exceptions as non-retryable internal errors", async () => {
		const { store, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const telemetry = createTelemetryMock();
		const service = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-03-28T08:00:00.000Z"),
			conversationStore,
			store,
			telemetry,
			executionRuntime: createExecutionRuntimeFromToolClient({
				execute: vi.fn().mockRejectedValue(new Error("untyped execution failure")),
			}),
		});

		const response = await service.submit({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "图书馆开放到几点？",
			},
			principal: createPrincipal(),
		});

		expect(finalWrites[0]).toMatchObject({
			assistantMessage: {
				kind: "error",
				retryable: false,
				text: "The request could not be completed.",
			},
			turnDispatch: {
				errorCode: "internal_error",
				status: "error",
			},
		});
		expect(response.answer.result).toEqual({
			errorCode: "internal_error",
			kind: "error",
			message: "The request could not be completed.",
			requestId: "req_0001",
			retryable: false,
			traceId: "trace_0001",
		});
		expect(telemetry.recordRequestTransportError).toHaveBeenCalledWith(
			expect.objectContaining({
				errorCode: "internal_error",
				requestId: "req_0001",
				retryable: false,
			}),
		);
	});

	it("replays a completed idempotent request and blocks conflicts or in-flight duplicates", async () => {
		const replayConversation = createConversation();
		replayConversation.messages.push(
			{
				conversationId: "conv_01HQ",
				createdAt: "2026-03-28T08:00:00.000Z",
				id: "msg_user",
				kind: null,
				requestId: null,
				retryable: null,
				role: "user",
				structuredParts: [],
				text: "图书馆开放到几点？",
			},
			{
				conversationId: "conv_01HQ",
				createdAt: "2026-03-28T08:00:01.000Z",
				id: "msg_answer",
				kind: "answer",
				requestId: "req_prev",
				retryable: null,
				role: "assistant",
				structuredParts: [],
				text: "图书馆开放到 22:00。",
			},
		);

		const replayResponse = {
			answer: {
				conversation: replayConversation,
				result: {
					kind: "answer" as const,
					requestId: "req_prev",
					text: "图书馆开放到 22:00。",
					traceId: "trace_prev",
				},
			},
			requestId: "req_prev",
			traceId: "trace_prev",
		};

		const { store } = createCommandStore();
		const { store: conversationStore } = createConversationStore({
			conversation: replayConversation,
		});
		const findIdempotentRequest = vi
			.fn()
			.mockResolvedValueOnce({
				requestFingerprintSha256: "fingerprint:图书馆开放到几点？",
				response: replayResponse,
				status: "completed",
			})
			.mockResolvedValueOnce({
				requestFingerprintSha256: "fingerprint:图书馆开放到几点？",
				response: replayResponse,
				status: "accepted",
			})
			.mockResolvedValueOnce({
				requestFingerprintSha256: "fingerprint:other",
				response: replayResponse,
				status: "completed",
			});
		store.findIdempotentRequest = findIdempotentRequest;
		const executionClient = {
			execute: vi.fn(),
		} satisfies ToolExecutionClient;

		const service = buildChatCommandService({
			computeFingerprint: () => "fingerprint:图书馆开放到几点？",
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-03-28T08:00:00.000Z"),
			conversationStore,
			store,
			executionRuntime: createExecutionRuntimeFromToolClient(executionClient),
		});

		const replay = await service.submit({
			idempotencyKey: "idem-001",
			payload: {
				conversationId: "conv_01HQ",
				prompt: "图书馆开放到几点？",
			},
			principal: createPrincipal(),
		});

		expect(replay).toEqual(replayResponse);
		expect(executionClient.execute).not.toHaveBeenCalled();

		await expect(
			service.submit({
				idempotencyKey: "idem-001",
				payload: {
					conversationId: "conv_01HQ",
					prompt: "图书馆开放到几点？",
				},
				principal: createPrincipal(),
			}),
		).rejects.toMatchObject({
			code: "request_in_progress",
			status: 409,
		});

		await expect(
			service.submit({
				idempotencyKey: "idem-001",
				payload: {
					conversationId: "conv_01HQ",
					prompt: "图书馆开放到几点？",
				},
				principal: createPrincipal(),
			}),
		).rejects.toMatchObject({
			code: "idempotency_conflict",
			status: 409,
		});
	});

	it("creates a first-turn conversation with the caller-provided conversation id", async () => {
		const { store, acceptedWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const executionClient: ToolExecutionClient = {
			execute: vi.fn().mockResolvedValue({
				answerText: "图书馆开放到 22:00。",
				error: null,
				followUpQuestion: "",
				result: {
					evidence: {
						sources: [],
					},
				},
				resolvedTargets: ["student_rules"],
				selectedTool: "knowledge_query",
				status: "completed",
				traceId: "trace_0001",
			}),
		};
		const service = buildChatCommandService({
			computeFingerprint: (input) =>
				`fingerprint:${input.conversationDiscriminator}:${input.prompt}`,
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-03-28T08:00:00.000Z"),
			conversationStore,
			store,
			executionRuntime: createExecutionRuntimeFromToolClient(executionClient),
		});

		const response = await service.submit({
			payload: {
				conversationId: "conv_client_0001",
				prompt: "图书馆开放到几点？",
			},
			principal: createPrincipal(),
		});

		expect(conversationStore.getConversationByOwner).toHaveBeenCalledWith(
			"user_01HQ",
			"conv_client_0001",
		);
		expect(acceptedWrites[0]).toMatchObject({
			conversationSeed: {
				id: "conv_client_0001",
				ownerUserId: "user_01HQ",
				title: "图书馆开放到几点？",
			},
			turnDispatch: {
				conversationId: "conv_client_0001",
			},
		});
		expect(executionClient.execute).toHaveBeenCalledWith(
			expect.objectContaining({
				conversationId: "conv_client_0001",
			}),
		);
		expect(response.answer.conversation).toMatchObject({
			id: "conv_client_0001",
			title: "图书馆开放到几点？",
		});
	});

	it("creates a conversation lazily on the first chat request when conversationId is omitted", async () => {
		const { store, acceptedWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const executionClient: ToolExecutionClient = {
			execute: vi.fn().mockResolvedValue({
				answerText: "图书馆开放到 22:00。",
				error: null,
				followUpQuestion: "",
				result: {
					evidence: {
						sources: [],
					},
				},
				resolvedTargets: ["student_rules"],
				selectedTool: "knowledge_query",
				status: "completed",
				traceId: "trace_0001",
			}),
		};
		const service = buildChatCommandService({
			computeFingerprint: (input) =>
				`fingerprint:${input.conversationDiscriminator}:${input.prompt}`,
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-03-28T08:00:00.000Z"),
			conversationStore,
			store,
			executionRuntime: createExecutionRuntimeFromToolClient(executionClient),
		});

		const response = await service.submit({
			idempotencyKey: "idem-001",
			payload: {
				prompt: "图书馆开放到几点？",
			},
			principal: createPrincipal(),
		});

		expect(conversationStore.getConversationByOwner).toHaveBeenCalledWith("user_01HQ", "conv_0001");
		expect(acceptedWrites[0]).toMatchObject({
			conversationSeed: {
				id: "conv_0001",
				ownerUserId: "user_01HQ",
				title: "图书馆开放到几点？",
			},
			turnDispatch: {
				conversationId: "conv_0001",
			},
		});
		expect(store.findIdempotentRequest).toHaveBeenCalledWith({
			actorUserId: "user_01HQ",
			idempotencyKey: "idem-001",
		});
		expect(executionClient.execute).toHaveBeenCalledWith(
			expect.objectContaining({
				conversationId: "conv_0001",
			}),
		);
		expect(response.answer.conversation).toMatchObject({
			id: "conv_0001",
			title: "图书馆开放到几点？",
		});
	});

	it("uses a stable new-conversation fingerprint scope for idempotent first-turn retries", async () => {
		const { store } = createCommandStore();
		store.findIdempotentRequest = vi.fn().mockResolvedValue({
			requestFingerprintSha256: "fingerprint:__new__:图书馆开放到几点？",
			response: {
				answer: {
					conversation: {
						createdAt: "2026-03-28T08:00:00.000Z",
						id: "conv_0001",
						messages: [],
						title: DRAFT_CONVERSATION_TITLE,
						updatedAt: "2026-03-28T08:00:00.000Z",
					},
					result: {
						kind: "answer",
						requestId: "req_prev",
						text: "图书馆开放到 22:00。",
						traceId: "trace_prev",
					},
				},
				requestId: "req_prev",
				traceId: "trace_prev",
			},
			status: "completed",
		});
		const service = buildChatCommandService({
			computeFingerprint: (input) =>
				`fingerprint:${input.conversationDiscriminator}:${input.prompt}`,
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-03-28T08:00:00.000Z"),
			conversationStore: createConversationStore().store,
			store,
			executionRuntime: createExecutionRuntimeFromToolClient({
				execute: vi.fn(),
			}),
		});

		const response = await service.submit({
			idempotencyKey: "idem-001",
			payload: {
				prompt: "图书馆开放到几点？",
			},
			principal: createPrincipal(),
		});

		expect(response.requestId).toBe("req_prev");
		expect(store.acceptRequest).not.toHaveBeenCalled();
	});
}
