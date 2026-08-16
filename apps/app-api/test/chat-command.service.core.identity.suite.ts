import { expect, it, vi } from "vitest";

import {
	buildChatCommandService,
	createCommandStore,
	createConversationStore,
	createDeterministicIdGenerator,
	createExecutionRuntimeFromToolClient,
	createHmac,
	createPrincipal,
	createTelemetryMock,
	deriveSafetyIdentifier,
	type ToolExecutionClient,
} from "./chat-command.service.test-support";

const EXPECTED_LANGFUSE_TRACE_PARENT = "00-5f8392c82813604cd79a0f7eb8b7306a-0000000000000001-01";

export function registerChatCommandServiceCoreIdentitySuite(): void {
	it("derives safety identifier from principal first, then app-owned session id, else null", () => {
		const principal = createPrincipal();
		const secret = "phase-h-safety-secret";

		expect(deriveSafetyIdentifier(principal, secret)).toBe(
			createHmac("sha256", secret).update("principal:user_01HQ").digest("hex"),
		);

		expect(
			deriveSafetyIdentifier(
				{
					...principal,
					principal: {
						...principal.principal,
						principalId: "",
					},
				},
				secret,
			),
		).toBe(createHmac("sha256", secret).update("session:sess_01HQ").digest("hex"));

		expect(
			deriveSafetyIdentifier(
				{
					...principal,
					principal: {
						...principal.principal,
						principalId: "",
					},
					session: null,
				},
				secret,
			),
		).toBeNull();
	});

	it("fails closed when an authenticated principal lacks the safety HMAC secret", () => {
		expect(() => deriveSafetyIdentifier(createPrincipal(), "")).toThrow(
			"APP_API_SAFETY_IDENTIFIER_HMAC_SECRET is required",
		);
	});

	it("accepts a chat request, calls executionClient with explicit actor, and finalizes a completed answer", async () => {
		const { store, acceptedWrites, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const telemetry = createTelemetryMock();
		const safetySecret = "phase-h-safety-secret";
		const expectedSafetyIdentifier = createHmac("sha256", safetySecret)
			.update("principal:user_01HQ")
			.digest("hex");
		const executionClient: ToolExecutionClient = {
			execute: vi.fn().mockResolvedValue({
				answerText: "图书馆开放到 22:00。",
				error: null,
				followUpQuestion: "",
				modelUsage: { cachedInputTokens: 10, inputTokens: 120, outputTokens: 42, totalTokens: 162 },
				result: {
					sources: [{ doc_id: "handbook:library-hours" }],
				},
				status: "completed",
				traceId: "trace_0001",
			}),
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
			idempotencyKey: "idem-001",
			payload: {
				conversationId: "conv_01HQ",
				prompt: " 图书馆开放到几点？ ",
			},
			principal: createPrincipal(),
			requestKind: "public_chat",
		});

		expect(executionClient.execute).toHaveBeenCalledWith(
			expect.objectContaining({
				conversationId: "conv_01HQ",
				context: expect.objectContaining({
					actor: expect.objectContaining(createPrincipal().actor),
					authorization: createPrincipal().authorization,
					session: {
						confirmedSlots: [],
						turnCount: 1,
					},
				}),
				requestId: "req_0001",
				safetyIdentifier: expectedSafetyIdentifier,
				surface: "campus_web",
				tenantId: "tenant-main",
				traceHeaders: { traceParent: EXPECTED_LANGFUSE_TRACE_PARENT },
				traceId: "trace_0001",
				userGoal: "图书馆开放到几点？",
			}),
		);
		expect(telemetry.configureChatRequestScope).toHaveBeenCalledWith(
			expect.objectContaining({
				requestId: "req_0001",
				safetyIdentifier: expectedSafetyIdentifier,
				traceId: "trace_0001",
			}),
		);
		expect(acceptedWrites).toHaveLength(1);
		const [acceptedWrite] = acceptedWrites;
		if (!acceptedWrite) {
			throw new Error("Expected one accepted chat write.");
		}
		expect(acceptedWrite).toMatchObject({
			turnDispatch: {
				actorUserId: "user_01HQ",
				idempotencyKey: "idem-001",
				principalSnapshot: {
					actor: {
						principalId: "user_01HQ",
						userId: "user_01HQ",
					},
					authorization: {
						applicabilityScope: "undergraduate",
						entitlementGroups: ["students"],
						entitlementSnapshotId: "entitlements-2026-03-29",
						visibilityScope: "main",
					},
					principal: {
						displayName: "Jane Doe",
						principalId: "user_01HQ",
						type: "student",
					},
				},
				requestId: "req_0001",
				safetyIdentifier: expectedSafetyIdentifier,
				status: "accepted",
				traceId: "trace_0001",
			},
			requestObservabilityFact: {
				requestId: "req_0001",
				safetyIdentifier: expectedSafetyIdentifier,
			},
			userMessage: {
				text: "图书馆开放到几点？",
			},
		});
		expect(acceptedWrite.turnDispatch).not.toHaveProperty("actorSnapshot");
		expect(acceptedWrite.turnDispatch).not.toHaveProperty("actorGroups");
		expect(acceptedWrite.turnDispatch).not.toHaveProperty("actorCampusScope");
		expect(finalWrites).toHaveLength(1);
		const [finalWrite] = finalWrites;
		if (!finalWrite) {
			throw new Error("Expected one finalized chat write.");
		}
		expect(finalWrite).toMatchObject({
			assistantMessage: {
				kind: "answer",
				requestId: "req_0001",
				role: "assistant",
				text: "图书馆开放到 22:00。",
			},
			turnDispatch: {
				requestId: "req_0001",
				safetyIdentifier: expectedSafetyIdentifier,
				status: "completed",
			},
			requestObservabilityFact: {
				entitlementSnapshotId: "entitlements-2026-03-29",
				principalType: "student",
				requestId: "req_0001",
				safetyIdentifier: expectedSafetyIdentifier,
			},
		});
		expect(finalWrite.turnDispatch).not.toHaveProperty("actorGroups");
		expect(finalWrite.turnDispatch).not.toHaveProperty("actorCampusScope");
		expect(response).toMatchObject({
			answer: {
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
					traceId: "trace_0001",
				},
			},
			requestId: "req_0001",
			traceId: "trace_0001",
		});
		expect(telemetry.recordRequestAccepted).toHaveBeenCalledWith(
			expect.objectContaining({
				conversationId: "conv_01HQ",
				requestId: "req_0001",
				safetyIdentifier: expectedSafetyIdentifier,
				traceId: "trace_0001",
			}),
		);
		expect(telemetry.recordRequestFinalized).toHaveBeenCalledWith(
			expect.objectContaining({
				requestId: "req_0001",
				safetyIdentifier: expectedSafetyIdentifier,
				sourceDocIds: ["handbook:library-hours"],
				status: "completed",
			}),
		);
		expect(telemetry.recordRequestTransportError).not.toHaveBeenCalled();
	});

	it("does not project PG profile memory during chat submit because execution-control owns memory recall", async () => {
		const { store } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const executionClient: ToolExecutionClient = {
			execute: vi.fn().mockResolvedValue({
				answerText: "可以，先看培养方案和学院通知。",
				error: null,
				followUpQuestion: "",
				modelUsage: { cachedInputTokens: 10, inputTokens: 120, outputTokens: 42, totalTokens: 162 },
				result: {},
				status: "completed",
				traceId: "trace_0001",
			}),
		};

		const service = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-04-27T08:00:00.000Z"),
			conversationStore,
			store,
			executionRuntime: createExecutionRuntimeFromToolClient(executionClient),
		});

		await service.submit({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "我接下来该看什么？",
			},
			principal: createPrincipal(),
			requestKind: "public_chat",
		});

		expect(executionClient.execute).toHaveBeenCalledWith(
			expect.objectContaining({
				context: expect.not.objectContaining({
					profileMemory: expect.anything(),
				}),
			}),
		);
	});
}
