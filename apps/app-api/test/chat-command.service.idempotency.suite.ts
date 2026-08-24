import { expect, it, vi } from "vitest";

import {
	buildChatCommandService,
	ChatAcceptanceConversationConflict,
	ChatAcceptanceIdempotencyConflict,
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
		store.getAbuseControlState = getAbuseControlState;
		const executionClient: ToolExecutionClient = {
			execute: vi.fn(),
		};
		const service = buildChatCommandService({
			deriveSafetyIdentifier: (principal) => deriveSafetyIdentifier(principal, safetySecret),
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-03-28T08:00:00.000Z"),
			conversationStore,
			store,
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
		expect(telemetry.configureRequestOutcome).toHaveBeenCalledWith(
			expect.objectContaining({
				errorCode: "rate_limit_exceeded",
				requestId: "req_0001",
				status: "rejected",
				surface: "campus_web",
				traceId: "trace_0001",
			}),
		);
	});

	it("skips the abuse throttle in development and still executes the request", async () => {
		const { store, acceptedWrites, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const telemetry = createTelemetryMock();
		const getAbuseControlState = vi.fn().mockResolvedValue({
			activeThrottleUntil: "2026-03-28T08:05:00.000Z",
			requestCountLastMinute: 9,
			requestCountLastTenMinutes: 9,
			shouldThrottle: true,
			throttleReason: "requests_per_minute",
		});
		store.getAbuseControlState = getAbuseControlState;
		const executionClient: ToolExecutionClient = {
			execute: vi.fn().mockResolvedValue({
				answerText: "可以继续处理。",
				error: null,
				modelUsage: {
					cachedInputTokens: 0,
					inputTokens: 1,
					outputTokens: 1,
					totalTokens: 2,
				},
				result: { sources: [] },
				status: "completed",
				traceId: "trace_0001",
			}),
		};
		const service = buildChatCommandService({
			abuseThrottleEnabled: false,
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-03-28T08:00:00.000Z"),
			conversationStore,
			store,
			executionRuntime: createExecutionRuntimeFromToolClient(executionClient),
			telemetry,
		});

		const response = await service.submit({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "开发环境批量评测请求",
			},
			principal: createPrincipal(),
		});

		expect(acceptedWrites).toHaveLength(1);
		expect(getAbuseControlState).not.toHaveBeenCalled();
		expect(executionClient.execute).toHaveBeenCalledOnce();
		expect(response.answer.result).toMatchObject({
			kind: "answer",
			text: "可以继续处理。",
		});
		expect(response.answer.result).not.toMatchObject({
			errorCode: "rate_limit_exceeded",
		});
		expect(finalWrites).toHaveLength(1);
	});

	it("recovers a durable run after a retryable create response loss", async () => {
		const { store, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const telemetry = createTelemetryMock();
		const executionRuntime = createExecutionRuntimeFromToolClient({
			execute: vi.fn().mockRejectedValue(
				new ExecutionControlTransportError({
					code: "execution_timeout",
					message: "Execution timed out.",
					retryable: true,
					status: 504,
				}),
			),
		});
		const service = buildChatCommandService({
			durableEventPolling: {
				maxAttempts: 1,
			},
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-03-28T08:00:00.000Z"),
			conversationStore,
			store,
			telemetry,
			executionRuntime,
		});

		await expect(
			service.submit({
				payload: {
					conversationId: "conv_01HQ",
					prompt: "图书馆开放到几点？",
				},
				principal: createPrincipal(),
			}),
		).rejects.toMatchObject({ code: "execution_status_pending", retryable: true });

		expect(executionRuntime.getRun).toHaveBeenCalledWith(
			expect.objectContaining({
				runId: "run_0001",
				traceId: "trace_0001",
			}),
		);
		expect(finalWrites).toHaveLength(0);
		expect(telemetry.configureRequestOutcome).not.toHaveBeenCalled();
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
				acceptedAt: "2026-03-28T07:59:00.000Z",
				requestFingerprintSha256: "fingerprint:图书馆开放到几点？",
				response: replayResponse,
				runId: "run_prev",
				status: "completed",
			})
			.mockResolvedValueOnce({
				acceptedAt: "2026-03-28T07:59:00.000Z",
				requestFingerprintSha256: "fingerprint:other",
				response: replayResponse,
				runId: "run_prev",
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
			code: "idempotency_conflict",
			status: 409,
		});
	});

	it("returns a stable fingerprint conflict after a concurrent idempotency winner differs", async () => {
		const { store } = createCommandStore();
		store.findIdempotentRequest = vi
			.fn()
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({
				acceptedAt: "2026-03-28T08:00:00.000Z",
				requestFingerprintSha256: "fingerprint:other",
				response: {
					answer: {
						conversation: createConversation(),
						result: {
							kind: "answer",
							requestId: "req_winner",
							text: "",
							traceId: "trace_winner",
						},
					},
					requestId: "req_winner",
					traceId: "trace_winner",
				},
				runId: "run_winner",
				status: "accepted",
			});
		store.acceptRequest = vi.fn().mockRejectedValue(new ChatAcceptanceIdempotencyConflict());
		const { store: conversationStore } = createConversationStore();
		const service = buildChatCommandService({
			computeFingerprint: () => "fingerprint:图书馆开放到几点？",
			conversationStore,
			executionRuntime: createExecutionRuntimeFromToolClient({ execute: vi.fn() }),
			store,
		});

		await expect(
			service.submit({
				idempotencyKey: "idem-race",
				payload: { conversationId: "conv_01HQ", prompt: "图书馆开放到几点？" },
				principal: createPrincipal(),
			}),
		).rejects.toMatchObject({ code: "idempotency_conflict", status: 409 });
		expect(store.findIdempotentRequest).toHaveBeenCalledTimes(2);
	});

	it("returns a retryable conflict when the locked conversation baseline changed", async () => {
		const { store } = createCommandStore();
		store.acceptRequest = vi.fn().mockRejectedValue(new ChatAcceptanceConversationConflict());
		const { store: conversationStore } = createConversationStore();
		const executionRuntime = createExecutionRuntimeFromToolClient({ execute: vi.fn() });
		const createRun = vi.spyOn(executionRuntime, "createRun");
		const service = buildChatCommandService({
			conversationStore,
			executionRuntime,
			store,
		});

		await expect(
			service.submit({
				payload: { conversationId: "conv_01HQ", prompt: "图书馆开放到几点？" },
				principal: createPrincipal(),
			}),
		).rejects.toMatchObject({
			code: "conversation_changed",
			retryable: true,
			status: 409,
		});
		expect(createRun).not.toHaveBeenCalled();
	});

	it("creates a first-turn conversation with the caller-provided conversation id", async () => {
		const { store, acceptedWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const executionClient: ToolExecutionClient = {
			execute: vi.fn().mockResolvedValue({
				answerText: "图书馆开放到 22:00。",
				error: null,
				modelUsage: { cachedInputTokens: 10, inputTokens: 120, outputTokens: 42, totalTokens: 162 },
				result: {
					evidence: {
						sources: [],
					},
				},
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
				modelUsage: { cachedInputTokens: 10, inputTokens: 120, outputTokens: 42, totalTokens: 162 },
				result: {
					evidence: {
						sources: [],
					},
				},
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
			acceptedAt: "2026-03-28T07:59:00.000Z",
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
			runId: "run_prev",
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
