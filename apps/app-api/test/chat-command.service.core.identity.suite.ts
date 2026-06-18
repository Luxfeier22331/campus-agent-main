import { expect, it, vi } from "vitest";

import {
	buildChatCommandService,
	type CapabilityExecutionClient,
	createCommandStore,
	createConversationStore,
	createDeterministicIdGenerator,
	createExecutionRuntimeFromCapabilityClient,
	createHmac,
	createPrincipal,
	createTelemetryMock,
	deriveSafetyIdentifier,
} from "./chat-command.service.test-support";

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
	it("accepts a chat request, calls supervisor with explicit actor, and finalizes a completed answer", async () => {
		const { store, acceptedWrites, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const telemetry = createTelemetryMock();
		const safetySecret = "phase-h-safety-secret";
		const expectedSafetyIdentifier = createHmac("sha256", safetySecret)
			.update("principal:user_01HQ")
			.digest("hex");
		const supervisor: CapabilityExecutionClient = {
			execute: vi.fn().mockResolvedValue({
				answerText: "图书馆开放到 22:00。",
				error: null,
				followUpQuestion: "",
				result: {
					evidence: {
						sources: [{ doc_id: "handbook:library-hours" }],
					},
				},
				selectedCapability: "knowledge",
				status: "completed",
				traceId: "trace_0002",
			}),
		};

		const service = buildChatCommandService({
			deriveSafetyIdentifier: (principal) => deriveSafetyIdentifier(principal, safetySecret),
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-03-28T08:00:00.000Z"),
			conversationStore,
			store,
			executionRuntime: createExecutionRuntimeFromCapabilityClient(supervisor),
			telemetry,
		});

		const response = await service.submit({
			idempotencyKey: "idem-001",
			payload: {
				conversationId: "conv_01HQ",
				prompt: " 图书馆开放到几点？ ",
				requestedCapability: "knowledge",
				requestedScope: {
					collection: "student_rules",
					corpus: "regulations",
				},
			},
			principal: createPrincipal(),
			surface: "campus_web",
		});

		expect(supervisor.execute).toHaveBeenCalledWith({
			conversationId: "conv_01HQ",
			context: {
				actor: createPrincipal().actor,
				authorization: createPrincipal().authorization,
				session: {
					confirmedSlots: [],
					turnCount: 0,
				},
			},
			requestId: "req_0001",
			requestedCapability: "knowledge",
			requestedScope: {
				collection: "student_rules",
				corpus: "regulations",
			},
			safetyIdentifier: expectedSafetyIdentifier,
			surface: "campus_web",
			traceHeaders: {
				baggage: "sentry-environment=test",
				sentryTrace: "0123456789abcdef0123456789abcdef-0123456789abcdef-1",
			},
			traceId: "trace_0001",
			userGoal: "图书馆开放到几点？",
			versionQuery: null,
		});
		expect(telemetry.configureChatRequestScope).toHaveBeenCalledWith(
			expect.objectContaining({
				requestId: "req_0001",
				requestedCapability: "knowledge",
				safetyIdentifier: expectedSafetyIdentifier,
				traceId: "trace_0001",
			}),
		);
		expect(acceptedWrites).toHaveLength(1);
		expect(acceptedWrites[0]).toMatchObject({
			outboxEvent: {
				eventType: "request.accepted",
			},
			requestExecution: {
				applicabilityScope: "undergraduate",
				actorPrincipalId: "user_01HQ",
				actorUserId: "user_01HQ",
				entitlementGroups: ["students"],
				entitlementSnapshotId: "entitlements-2026-03-29",
				idempotencyKey: "idem-001",
				principalLabel: "Jane Doe",
				principalType: "student",
				questionPreview: "图书馆开放到几点？",
				requestId: "req_0001",
				safetyIdentifier: expectedSafetyIdentifier,
				status: "accepted",
				traceId: "trace_0001",
				visibilityScope: "main",
			},
			requestObservabilityFact: {
				requestId: "req_0001",
				safetyIdentifier: expectedSafetyIdentifier,
			},
		});
		expect(
			(acceptedWrites[0] as { requestExecution: Record<string, unknown> }).requestExecution,
		).not.toHaveProperty("actorSnapshot");
		expect(
			(acceptedWrites[0] as { requestExecution: Record<string, unknown> }).requestExecution,
		).not.toHaveProperty("actorGroups");
		expect(
			(acceptedWrites[0] as { requestExecution: Record<string, unknown> }).requestExecution,
		).not.toHaveProperty("actorCampusScope");
		expect(finalWrites).toHaveLength(1);
		expect(finalWrites[0]).toMatchObject({
			assistantMessage: {
				kind: "answer",
				requestId: "req_0001",
				role: "assistant",
				text: "图书馆开放到 22:00。",
			},
			outboxEvent: {
				eventType: "request.completed",
			},
			requestExecution: {
				answerPreview: "图书馆开放到 22:00。",
				applicabilityScope: "undergraduate",
				actorPrincipalId: "user_01HQ",
				entitlementGroups: ["students"],
				entitlementSnapshotId: "entitlements-2026-03-29",
				requestId: "req_0001",
				safetyIdentifier: expectedSafetyIdentifier,
				selectedCapability: "knowledge",
				sourceDocIds: ["handbook:library-hours"],
				status: "completed",
				visibilityScope: "main",
			},
			requestObservabilityFact: {
				requestId: "req_0001",
				safetyIdentifier: expectedSafetyIdentifier,
			},
		});
		expect(
			(finalWrites[0] as { requestExecution: Record<string, unknown> }).requestExecution,
		).not.toHaveProperty("actorGroups");
		expect(
			(finalWrites[0] as { requestExecution: Record<string, unknown> }).requestExecution,
		).not.toHaveProperty("actorCampusScope");
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
					traceId: "trace_0002",
				},
			},
			requestId: "req_0001",
			traceId: "trace_0002",
		});
		expect(telemetry.recordRequestAccepted).toHaveBeenCalledWith(
			expect.objectContaining({
				conversationId: "conv_01HQ",
				requestId: "req_0001",
				safetyIdentifier: expectedSafetyIdentifier,
				traceId: "trace_0001",
			}),
		);
		expect(telemetry.recordProjectionEnqueued).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				projectionStage: "accepted",
				requestId: "req_0001",
			}),
		);
		expect(telemetry.recordProjectionEnqueued).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				projectionStage: "finalized",
				requestId: "req_0001",
			}),
		);
		expect(telemetry.recordRequestFinalized).toHaveBeenCalledWith(
			expect.objectContaining({
				requestId: "req_0001",
				safetyIdentifier: expectedSafetyIdentifier,
				selectedCapability: "knowledge",
				sourceDocIds: ["handbook:library-hours"],
				status: "completed",
			}),
		);
		expect(telemetry.recordRequestTransportError).not.toHaveBeenCalled();
	});

	it("does not project PG profile memory during chat submit because execution-control owns memory recall", async () => {
		const { store } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const supervisor: CapabilityExecutionClient = {
			execute: vi.fn().mockResolvedValue({
				answerText: "可以，先看培养方案和学院通知。",
				error: null,
				followUpQuestion: "",
				result: {},
				selectedCapability: "knowledge",
				status: "completed",
				traceId: "trace_0002",
			}),
		};

		const service = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-04-27T08:00:00.000Z"),
			conversationStore,
			store,
			executionRuntime: createExecutionRuntimeFromCapabilityClient(supervisor),
		});

		await service.submit({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "我接下来该看什么？",
				requestedCapability: "knowledge",
			},
			principal: createPrincipal(),
			surface: "campus_web",
		});

		expect(supervisor.execute).toHaveBeenCalledWith(
			expect.objectContaining({
				context: expect.not.objectContaining({
					profileMemory: expect.anything(),
				}),
			}),
		);
	});
}
