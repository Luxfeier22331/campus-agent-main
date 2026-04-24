import { expect, it, vi } from "vitest";

import {
	buildChatCommandService,
	createCommandStore,
	createConversationStore,
	createDeterministicIdGenerator,
	createHmac,
	createPrincipal,
	createTelemetryMock,
	deriveSafetyIdentifier,
	expectNoInternalLocators,
	type FinalizeRequestWrite,
	type SupervisorExecutionClient,
} from "./chat-command.service.test-support";

export function registerChatCommandServiceCoreSuite(): void {
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
		const supervisor: SupervisorExecutionClient = {
			execute: vi.fn().mockResolvedValue({
				answerText: "图书馆开放到 22:00。",
				error: null,
				followUpQuestion: "",
				result: {
					evidence: {
						sources: [{ doc_id: "handbook:library-hours" }],
					},
				},
				selectedTarget: "rag-agent",
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
			supervisor,
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
			surface: "public_chat_web",
		});

		expect(supervisor.execute).toHaveBeenCalledWith({
			conversationId: "conv_01HQ",
			context: {
				actor: createPrincipal().actor,
				authorization: createPrincipal().authorization,
				profileMemory: {
					items: [],
				},
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
			surface: "public_chat_web",
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
				selectedTarget: "rag-agent",
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
				selectedTarget: "rag-agent",
				sourceDocIds: ["handbook:library-hours"],
				status: "completed",
			}),
		);
		expect(telemetry.recordRequestTransportError).not.toHaveBeenCalled();
	});

	it("leaves omitted requestedCapability unset so supervisor can infer the entrance intent", async () => {
		const { store, acceptedWrites, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const telemetry = createTelemetryMock();
		const supervisor: SupervisorExecutionClient = {
			execute: vi.fn().mockResolvedValue({
				answerText: "图书馆在海淀校区主教学区西侧。",
				error: null,
				followUpQuestion: "",
				result: {
					place_card: {
						location_description: "海淀校区主教学区西侧。",
						place: {
							display_name: "图书馆",
							entity_type: "building",
							place_id: "muc.haidian.library",
						},
					},
				},
				selectedTarget: "navigation-agent",
				status: "completed",
				traceId: "trace_0002",
			}),
		};
		const service = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-04-11T09:00:00.000Z"),
			conversationStore,
			store,
			supervisor,
			telemetry,
		});

		await service.submit({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "图书馆在哪里",
			},
			principal: createPrincipal(),
			surface: "public_chat_web",
		});

		expect(supervisor.execute).toHaveBeenCalledWith(
			expect.objectContaining({
				requestedCapability: null,
				userGoal: "图书馆在哪里",
			}),
		);
		expect(acceptedWrites[0]).toMatchObject({
			requestExecution: {
				requestedCapability: null,
			},
			requestObservabilityFact: {
				requestedCapability: null,
			},
		});
		expect(finalWrites[0]).toMatchObject({
			requestExecution: {
				requestedCapability: null,
				selectedTarget: "navigation-agent",
			},
			requestObservabilityFact: {
				requestedCapability: null,
			},
		});
		expect(telemetry.configureChatRequestScope).toHaveBeenCalledWith(
			expect.objectContaining({
				requestedCapability: null,
			}),
		);
	});

	it("passes explicit versionQuery through validation, supervisor execution, and request writes", async () => {
		const { store, acceptedWrites, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const supervisor: SupervisorExecutionClient = {
			execute: vi.fn().mockResolvedValue({
				answerText: "2024 版学生手册中图书馆开放到 21:30。",
				error: null,
				followUpQuestion: "",
				result: {
					evidence: {
						sources: [{ doc_id: "handbook:library-hours:v2024" }],
					},
				},
				selectedTarget: "rag-agent",
				status: "completed",
				traceId: "trace_0002",
			}),
		};
		const service = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-03-28T08:00:00.000Z"),
			conversationStore,
			store,
			supervisor,
		});

		await service.submit({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "2024 版学生手册里的图书馆开放到几点？",
				requestedScope: {
					collection: "student_rules",
					corpus: "regulations",
				},
				versionQuery: {
					mode: "historical",
					versionId: "v2024-student-rules",
				},
			},
			principal: createPrincipal(),
		});

		expect(supervisor.execute).toHaveBeenCalledWith(
			expect.objectContaining({
				requestId: "req_0001",
				versionQuery: {
					mode: "historical",
					versionId: "v2024-student-rules",
				},
			}),
		);
		expect(acceptedWrites[0]).toMatchObject({
			requestExecution: {
				requestId: "req_0001",
				versionQuery: {
					mode: "historical",
					versionId: "v2024-student-rules",
				},
			},
			requestObservabilityFact: {
				requestId: "req_0001",
				versionQueryMode: "historical",
				versionQuerySummary: "historical:v2024-student-rules",
			},
		});
		expect(finalWrites[0]).toMatchObject({
			requestExecution: {
				requestId: "req_0001",
				versionQuery: {
					mode: "historical",
					versionId: "v2024-student-rules",
				},
			},
			requestObservabilityFact: {
				requestId: "req_0001",
				versionQueryMode: "historical",
				versionQuerySummary: "historical:v2024-student-rules",
			},
		});
	});

	it("rejects invalid versionQuery shapes before request acceptance", async () => {
		const { store } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const service = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-03-28T08:00:00.000Z"),
			conversationStore,
			store,
			supervisor: {
				execute: vi.fn(),
			},
		});

		await expect(
			service.submit({
				payload: {
					conversationId: "conv_01HQ",
					prompt: "比较 2024 和 2025 版学生手册",
					versionQuery: {
						compareToVersionId: "v2025-student-rules",
						mode: "compare",
					},
				},
				principal: createPrincipal(),
			}),
		).rejects.toMatchObject({
			code: "validation_failed",
			details: { field: "versionQuery.versionId" },
			status: 422,
		});
	});

	it("sanitizes internal source locators before writing completed answers to browser-facing chat surfaces", async () => {
		const { store, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const service = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-03-28T08:00:00.000Z"),
			conversationStore,
			store,
			supervisor: {
				execute: vi.fn().mockResolvedValue({
					answerText:
						"第四学期有合同法、人格权法、侵权责任法。 [program_semester_facts:法学（民族实验班）本科人才培养方案:semester-4#program_semester_facts:法学（民族实验班）本科人才培养方案:semester-4:source-faithful:sha256:test:chunk-0001]",
					error: null,
					followUpQuestion: "",
					result: {
						evidence: {
							sources: [
								{
									chunk_id:
										"program_semester_facts:法学（民族实验班）本科人才培养方案:semester-4:source-faithful:sha256:test:chunk-0001",
									collection: "program_semester_facts",
									doc_id: "program_semester_facts:法学（民族实验班）本科人才培养方案:semester-4",
								},
							],
						},
					},
					selectedTarget: "rag-agent",
					status: "completed",
					traceId: "trace_0002",
				}),
			},
		});

		const response = await service.submit({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "法学民族班培养方案里大二下有什么课",
				requestedScope: {
					collection: "curriculum_plan",
					corpus: "curriculum",
				},
			},
			principal: createPrincipal(),
		});
		const finalizedWrite = finalWrites[0] as FinalizeRequestWrite;

		expect(finalizedWrite).toMatchObject({
			assistantMessage: {
				kind: "answer",
			},
			requestExecution: {
				status: "completed",
			},
		});
		expectNoInternalLocators(finalizedWrite.assistantMessage.text);
		expect(finalizedWrite.assistantMessage.text).toContain(
			"第四学期有合同法、人格权法、侵权责任法。",
		);
		expect(response.answer.result.kind).toBe("answer");
		if (response.answer.result.kind !== "answer") {
			throw new Error("expected completed answer result");
		}
		expectNoInternalLocators(response.answer.result.text);
		expect(response.answer.result.text).toBe("第四学期有合同法、人格权法、侵权责任法。");
	});

	it("persists navigation place cards into assistant structured parts", async () => {
		const { store, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const supervisor: SupervisorExecutionClient = {
			execute: vi.fn().mockResolvedValue({
				answerText: "图书馆在海淀校区主教学区西侧，靠近校医院。",
				error: null,
				followUpQuestion: "",
				result: {
					matched_alias: "图书馆",
					place_card: {
						access_note: "访客请先完成入校登记。",
						campus_area: "主教学区西侧",
						coordinate_reference_system: "EPSG:4326",
						location_description: "海淀校区主教学区西侧，靠近校医院。",
						place: {
							campus_area: "主教学区西侧",
							campus_scope: "haidian",
							display_name: "图书馆",
							entity_type: "building",
							place_id: "muc.haidian.library",
						},
						point_geometry: {
							latitude: 39.96162,
							longitude: 116.31551,
						},
						source_refs: ["seed:campus_navigation/place_catalog.v1"],
					},
					query_text: "图书馆在哪里",
					resolved_place: {
						campus_area: "主教学区西侧",
						campus_scope: "haidian",
						display_name: "图书馆",
						entity_type: "building",
						place_id: "muc.haidian.library",
					},
				},
				selectedTarget: "navigation-agent",
				status: "completed",
				traceId: "trace_0002",
			}),
		};

		const service = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-04-11T09:00:00.000Z"),
			conversationStore,
			store,
			supervisor,
		});

		const response = await service.submit({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "图书馆在哪里",
			},
			principal: createPrincipal(),
			surface: "public_chat_web",
		});

		expect(finalWrites[0]).toMatchObject({
			assistantMessage: {
				kind: "answer",
				structuredParts: [
					{
						placeCard: {
							coordinateReferenceSystem: "EPSG:4326",
							displayName: "图书馆",
							entityType: "building",
							placeId: "muc.haidian.library",
						},
						type: "place_card",
					},
				],
			},
		});
		expect(response.answer.conversation.messages.at(-1)).toMatchObject({
			structuredParts: [
				{
					placeCard: {
						displayName: "图书馆",
						entityType: "building",
						placeId: "muc.haidian.library",
					},
					type: "place_card",
				},
			],
		});
	});

	it("persists navigation place cards even when point geometry is absent", async () => {
		const { store, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const supervisor: SupervisorExecutionClient = {
			execute: vi.fn().mockResolvedValue({
				answerText: "民族博物馆在海淀校区西侧，靠近图书馆。",
				error: null,
				followUpQuestion: "",
				result: {
					matched_alias: "民族博物馆",
					place_card: {
						campus_area: "海淀校区西侧",
						location_description: "海淀校区西侧，靠近图书馆。",
						place: {
							campus_area: "海淀校区西侧",
							campus_scope: "haidian",
							display_name: "民族博物馆",
							entity_type: "building",
							place_id: "muc.haidian.museum",
						},
						source_refs: [
							"seed:campus_navigation/place_catalog.v1",
							"https://www.muc.edu.cn/xxgk1/xydt.htm",
						],
					},
					query_text: "民族博物馆在哪里",
					resolved_place: {
						campus_area: "海淀校区西侧",
						campus_scope: "haidian",
						display_name: "民族博物馆",
						entity_type: "building",
						place_id: "muc.haidian.museum",
					},
				},
				selectedTarget: "navigation-agent",
				status: "completed",
				traceId: "trace_0003",
			}),
		};

		const service = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-04-11T10:00:00.000Z"),
			conversationStore,
			store,
			supervisor,
		});

		await service.submit({
			payload: {
				conversationId: "conv_02HQ",
				prompt: "民族博物馆在哪里",
			},
			principal: createPrincipal(),
			surface: "public_chat_web",
		});

		expect(finalWrites[0]).toMatchObject({
			assistantMessage: {
				structuredParts: [
					{
						placeCard: {
							displayName: "民族博物馆",
							placeId: "muc.haidian.museum",
							pointGeometry: null,
						},
						type: "place_card",
					},
				],
			},
		});
	});

	it("normalizes supervisor traceId in finalized responses when upstream payload omits it", async () => {
		const { store, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const service = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-03-28T08:00:00.000Z"),
			conversationStore,
			store,
			supervisor: {
				execute: vi.fn().mockResolvedValue({
					answerText: "图书馆开放到 22:00。",
					error: null,
					followUpQuestion: "",
					result: {
						evidence: {
							sources: [{ doc_id: "handbook:library-hours" }],
						},
					},
					selectedTarget: "rag-agent",
					status: "completed",
					traceId: "",
				}),
			},
		});

		const response = await service.submit({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "图书馆开放到几点？",
			},
			principal: createPrincipal(),
			surface: "eval_benchmark",
		});

		expect(response.traceId).toBe("trace_0001");
		expect(response.answer.result.traceId).toBe("trace_0001");
		expect(response.supervisor).toMatchObject({
			status: "completed",
			traceId: "trace_0001",
		});
		expect(finalWrites[0]).toMatchObject({
			requestExecution: {
				surface: "eval_benchmark",
				traceId: "trace_0001",
			},
			requestObservabilityFact: {
				surface: "eval_benchmark",
				traceId: "trace_0001",
			},
		});
	});

	it("passes eval_benchmark surface through to the supervisor client", async () => {
		const { store } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const supervisor: SupervisorExecutionClient = {
			execute: vi.fn().mockResolvedValue({
				answerText: "图书馆开放到 22:00。",
				error: null,
				followUpQuestion: "",
				result: {
					evidence: {
						sources: [{ doc_id: "handbook:library-hours" }],
					},
				},
				selectedTarget: "rag-agent",
				status: "completed",
				traceId: "trace_0002",
			}),
		};
		const service = buildChatCommandService({
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-03-28T08:00:00.000Z"),
			conversationStore,
			store,
			supervisor,
		});

		await service.submit({
			payload: {
				conversationId: "conv_01HQ",
				prompt: "图书馆开放到几点？",
			},
			principal: createPrincipal(),
			surface: "eval_benchmark",
		});

		expect(supervisor.execute).toHaveBeenCalledWith(
			expect.objectContaining({
				requestId: "req_0001",
				surface: "eval_benchmark",
			}),
		);
	});
}
