import { describe, expect, it, vi } from "vitest";

import { createApp as createAppApi } from "../../app-api/src/app";
import type {
	ExecutionActorContext,
	ExecutionAuthorizationContext,
} from "../../app-api/src/modules/auth";
import type {
	ExecutionControlRuntimeClient,
	SupervisorExecutionInput,
	SupervisorExecutionResponse,
} from "../../app-api/src/modules/integration";
import {
	buildChatCommandService,
	createCommandStore,
	createConversationStore,
	createDeterministicIdGenerator,
	createPrincipal,
	type FinalizeRequestWrite,
} from "../../app-api/test/chat-command.service.test-support";
import worker from "../src/index";
import {
	buildCampusServicesExecutionResponse,
	buildCampusServicesGuardrailExecutionResponse,
	CAMPUS_SERVICES_GUARDRAIL_CASES,
	CAMPUS_SERVICES_ROUTING_CASES,
	findCampusServicesGuardrailCase,
	findCampusServicesRoutingCase,
} from "./worker-campus-services-fixtures";

function durableRun(overrides: Record<string, unknown> = {}) {
	return {
		admittedAt: "",
		completedAt: "",
		conversationId: "conv_01HQ",
		createdAt: "2026-04-27T09:00:00.000Z",
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
		updatedAt: "2026-04-27T09:00:00.000Z",
		workflowPlanRef: "",
		...overrides,
	};
}

function durableFinalizationEvent(input: {
	requestId: string;
	response: SupervisorExecutionResponse;
	runId: string;
	traceId: string;
}) {
	return {
		conversationId: "conv_01HQ",
		eventId: `event-final-${input.requestId}`,
		eventType: "finalization.completed",
		occurredAt: "2026-04-27T09:00:02.000Z",
		payload: {
			request_id: input.requestId,
			response: toExecutionControlWireResponse(input.response),
			trace_id: input.traceId,
		},
		payloadSchemaVersion: "run-event-v1",
		runId: input.runId,
		sequence: 1,
		visibility: "browser",
	};
}

function toExecutionControlWireResponse(
	response: SupervisorExecutionResponse,
): Record<string, unknown> {
	return {
		answer_text: response.answerText,
		confidence: "high",
		error: response.error,
		follow_up_question: response.followUpQuestion,
		observability: toSnakeCaseRecord(response.observability ?? null),
		result: response.result && typeof response.result === "object" ? response.result : null,
		selected_target: response.selectedTarget,
		status: response.status,
		trace_id: response.traceId,
		workflow_trace_summary: toSnakeCaseRecord(response.workflowTraceSummary ?? null),
	};
}

function toSnakeCaseRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}

	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
			key.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`),
			Array.isArray(entry) ? entry.map((item) => toSnakeCaseValue(item)) : toSnakeCaseValue(entry),
		]),
	);
}

function toSnakeCaseValue(value: unknown): unknown {
	if (!value || typeof value !== "object") {
		return value;
	}
	if (Array.isArray(value)) {
		return value.map((item) => toSnakeCaseValue(item));
	}
	return toSnakeCaseRecord(value);
}

function supervisorInputContextFromWire(value: unknown): SupervisorExecutionInput["context"] {
	const context = recordFromWire(value, "execution payload context");
	return {
		actor: executionActorFromWire(context.actor),
		authorization: executionAuthorizationFromWire(context.authorization),
		profileMemory: profileMemoryFromWire(context.profile_memory),
		session: sessionFromWire(context.session),
	};
}

function executionActorFromWire(value: unknown): ExecutionActorContext {
	const actor = recordFromWire(value, "execution payload actor");
	return {
		cohort: stringOrUndefined(actor.cohort),
		departments: stringArray(actor.departments),
		major: stringOrUndefined(actor.major),
		principalId: requiredString(actor.principal_id, "actor.principal_id"),
		principalType: requiredString(
			actor.principal_type,
			"actor.principal_type",
		) as ExecutionActorContext["principalType"],
		program: stringOrUndefined(actor.program),
		roles: stringArray(actor.roles),
		userId: requiredString(actor.user_id, "actor.user_id"),
	};
}

function executionAuthorizationFromWire(value: unknown): ExecutionAuthorizationContext {
	const authorization = recordFromWire(value, "execution payload authorization");
	const retrievalFilter = recordFromWire(
		authorization.retrieval_filter,
		"execution payload retrieval filter",
	);
	return {
		applicabilityScope: stringOrUndefined(authorization.applicability_scope),
		approvalState: requiredString(authorization.approval_state, "authorization.approval_state"),
		entitlementGroups: stringArray(authorization.entitlement_groups),
		entitlementSnapshotId: requiredString(
			authorization.entitlement_snapshot_id,
			"authorization.entitlement_snapshot_id",
		),
		ownershipScopes: stringArray(authorization.ownership_scopes),
		principalId: requiredString(authorization.principal_id, "authorization.principal_id"),
		projectionSource: requiredString(
			authorization.projection_source,
			"authorization.projection_source",
		) as ExecutionAuthorizationContext["projectionSource"],
		retrievalFilter: {
			entitlementGroups: stringArray(retrievalFilter.entitlement_groups),
			policyProjectionVersion: requiredString(
				retrievalFilter.policy_projection_version,
				"authorization.retrieval_filter.policy_projection_version",
			),
			visibilityLevel: requiredString(
				retrievalFilter.visibility_level,
				"authorization.retrieval_filter.visibility_level",
			),
			visibilityScope: stringOrNull(retrievalFilter.visibility_scope),
		},
		visibilityScope: stringOrNull(authorization.visibility_scope),
	};
}

function profileMemoryFromWire(
	value: unknown,
): SupervisorExecutionInput["context"]["profileMemory"] {
	const profileMemory = recordFromWire(value, "execution payload profile memory");
	const items = Array.isArray(profileMemory.items) ? profileMemory.items : [];
	return {
		items: items.flatMap((item) => {
			if (!item || typeof item !== "object" || Array.isArray(item)) {
				return [];
			}
			const record = item as Record<string, unknown>;
			return [
				{
					confidence: stringOrUndefined(record.confidence),
					itemId: requiredString(record.item_id, "profile_memory.items[].item_id"),
					key: requiredString(record.key, "profile_memory.items[].key"),
					lastVerifiedAt: stringOrUndefined(record.last_verified_at),
					sourceType: stringOrUndefined(record.source_type),
					value: requiredString(record.value, "profile_memory.items[].value"),
					visibility: stringOrUndefined(record.visibility),
				},
			];
		}),
	};
}

function sessionFromWire(value: unknown): SupervisorExecutionInput["context"]["session"] {
	const session = recordFromWire(value, "execution payload session");
	const confirmedSlots = Array.isArray(session.confirmed_slots) ? session.confirmed_slots : [];
	return {
		confirmedSlots: confirmedSlots.flatMap((slot) => {
			if (!slot || typeof slot !== "object" || Array.isArray(slot)) {
				return [];
			}
			const record = slot as Record<string, unknown>;
			return [
				{
					confirmed: typeof record.confirmed === "boolean" ? record.confirmed : undefined,
					name: requiredString(record.name, "session.confirmed_slots[].name"),
					value: requiredString(record.value, "session.confirmed_slots[].value"),
				},
			];
		}),
		turnCount: typeof session.turn_count === "number" ? session.turn_count : 0,
	};
}

function recordFromWire(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${label} must be an object.`);
	}
	return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`${label} must be a non-empty string.`);
	}
	return value;
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
		: [];
}

function stringOrNull(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value : null;
}

function stringOrUndefined(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value : undefined;
}

describe("public chat web chat integration", () => {
	it("smokes a chat request through public-chat-web into app-api", async () => {
		const appApiEnv = {
			APP_API_NAME: "campus-agent-app-api",
			APP_API_ENVIRONMENT: "test" as const,
			BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
			PUBLIC_CHAT_WEB_ORIGIN: "https://chat.example.com",
			EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
			EXECUTION_CONTROL_SHARED_SECRET: "shared-secret",
			APP_API_OPERATOR_EMAIL_ALLOWLIST: "ops@example.com",
			APP_API_INTERNAL_SHARED_SECRET: "app-api-internal-secret",
			APP_API_DB: {
				connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
			},
		};
		const appApi = createAppApi(appApiEnv, {
			chatCommandService: {
				submit: vi.fn().mockResolvedValue({
					answer: {
						conversation: {
							createdAt: "2026-03-28T07:59:00.000Z",
							id: "conv_01HQ",
							messages: [],
							title: "图书馆开放时间",
							updatedAt: "2026-03-28T08:00:01.000Z",
						},
						result: {
							kind: "answer",
							requestId: "req_01HQ",
							text: "图书馆开放到 22:00。",
							traceId: "trace_01HQ",
						},
					},
					requestId: "req_01HQ",
					traceId: "trace_01HQ",
				}),
			},
			getPrincipal: vi.fn().mockResolvedValue({
				actor: {
					departments: [],
					principalId: "user_01HQ",
					principalType: "campus_member",
					roles: ["student"],
					userId: "user_01HQ",
				},
				permissions: {
					chat: true,
					operator: false,
				},
				principal: {
					displayName: "Jane Doe",
					email: "jane@example.edu",
					principalId: "user_01HQ",
					type: "campus_member",
				},
				session: {
					expiresAt: "2026-03-29T07:00:00.000Z",
					sessionId: "sess_01HQ",
				},
			}),
		});

		const response = await worker.fetch(
			new Request("https://chat.example.com/api/chat/requests", {
				body: JSON.stringify({
					prompt: "图书馆开放到几点？",
				}),
				headers: {
					"content-type": "application/json",
					cookie: "better-auth.session_token=test",
					"idempotency-key": "idem-001",
				},
				method: "POST",
			}),
			{
				APP_API: {
					fetch: async (request: Request) => appApi.fetch(request, appApiEnv),
				},
				APP_API_BASE_URL: "https://app-api.internal",
				ASSETS: {
					fetch: async () =>
						new Response('<!doctype html><html><body><div id="root"></div></body></html>', {
							headers: {
								"content-type": "text/html; charset=utf-8",
							},
							status: 200,
						}),
				},
				PUBLIC_CHAT_HOSTNAME: "chat.example.com",
			},
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(response.headers.get("x-request-id")).toBe("req_01HQ");
		await expect(response.json()).resolves.toMatchObject({
			answer: {
				result: {
					kind: "answer",
					requestId: "req_01HQ",
				},
			},
		});
	});

	it("routes campus-services prompts through public-chat-web into structured agent handoffs", async () => {
		const { store, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const observedResults: Record<string, unknown>[] = [];
		const supervisorExecute = vi.fn(async (input: SupervisorExecutionInput) => {
			const route = findCampusServicesRoutingCase(input.userGoal);
			const response = buildCampusServicesExecutionResponse(input, route);
			observedResults.push(response.result as Record<string, unknown>);
			return response;
		});
		const executionRuntime: ExecutionControlRuntimeClient = {
			cancelRun: vi.fn(),
			createRun: vi.fn(async (input) =>
				durableRun({
					conversationId: input.conversationId,
					ownerUserId: input.ownerUserId,
					requestId: input.requestId,
					requestedCapability: input.requestedCapability ?? "",
					runId: input.runId,
					selectedCapability: input.selectedCapability ?? "",
					surface: input.surface,
					traceId: input.traceId ?? "",
					turnId: input.turnId,
				}),
			),
			getRun: vi.fn(),
			listRunEvents: vi.fn(async (input) => {
				const createInput = vi.mocked(executionRuntime.createRun).mock.calls.at(-1)?.[0];
				if (!createInput) {
					throw new Error("durable run was not created before event polling.");
				}
				const executionPayload = createInput.metadata.execution_payload as {
					context: unknown;
					request_id: string;
					trace: { trace_id: string };
					user_goal: string;
				};
				const response = await supervisorExecute({
					context: supervisorInputContextFromWire(executionPayload.context),
					conversationId: createInput.conversationId,
					requestId: executionPayload.request_id,
					requestedCapability: createInput.requestedCapability,
					requestedScope: null,
					safetyIdentifier: null,
					surface: createInput.surface,
					traceHeaders: createInput.traceHeaders,
					traceId: executionPayload.trace.trace_id,
					userGoal: executionPayload.user_goal,
					versionQuery: null,
				});
				return [
					durableFinalizationEvent({
						requestId: executionPayload.request_id,
						response,
						runId: input.runId,
						traceId: executionPayload.trace.trace_id,
					}),
				];
			}),
			listRunSteps: vi.fn(async () => ({ attempts: [], results: [], steps: [] })),
		};
		const chatCommandService = buildChatCommandService({
			conversationStore,
			durableEventPolling: {
				maxAttempts: 1,
				pollIntervalMs: 0,
			},
			executionRuntime,
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-04-27T09:00:00.000Z"),
			store,
		});
		const appApiEnv = {
			APP_API_NAME: "campus-agent-app-api",
			APP_API_ENVIRONMENT: "test" as const,
			BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
			PUBLIC_CHAT_WEB_ORIGIN: "https://chat.example.com",
			EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
			EXECUTION_CONTROL_SHARED_SECRET: "shared-secret",
			APP_API_OPERATOR_EMAIL_ALLOWLIST: "ops@example.com",
			APP_API_INTERNAL_SHARED_SECRET: "app-api-internal-secret",
			APP_API_DB: {
				connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
			},
		};
		const appApi = createAppApi(appApiEnv, {
			chatCommandService,
			getPrincipal: vi.fn().mockResolvedValue(createPrincipal()),
		});

		for (const route of CAMPUS_SERVICES_ROUTING_CASES) {
			const response = await worker.fetch(
				new Request("https://chat.example.com/api/chat/requests", {
					body: JSON.stringify({
						prompt: route.prompt,
					}),
					headers: {
						"content-type": "application/json",
						cookie: "better-auth.session_token=test",
						"idempotency-key": `idem-${route.expectedTool}`,
					},
					method: "POST",
				}),
				{
					APP_API: {
						fetch: async (request: Request) => appApi.fetch(request, appApiEnv),
					},
					APP_API_BASE_URL: "https://app-api.internal",
					ASSETS: {
						fetch: async () =>
							new Response('<!doctype html><html><body><div id="root"></div></body></html>', {
								headers: {
									"content-type": "text/html; charset=utf-8",
								},
								status: 200,
							}),
					},
					PUBLIC_CHAT_HOSTNAME: "chat.example.com",
				},
			);
			const payload = (await response.json()) as {
				answer?: {
					conversation?: {
						messages?: Array<{
							structuredParts?: Array<{
								type?: string;
								traceCards?: Array<{
									refs?: string[];
									title?: string;
								}>;
							}>;
						}>;
					};
					result?: {
						kind?: string;
						text?: string;
					};
				};
			};

			expect(response.status).toBe(200);
			expect(response.headers.get("cache-control")).toBe("no-store");
			expect(payload.answer?.result).toMatchObject({
				kind: "answer",
				text: expect.stringContaining(route.expectedAnswerFragment),
			});
			if (payload.answer?.result?.text) {
				expect(payload.answer.result.text).not.toContain("projection_internal_state");
				expect(payload.answer.result.text).not.toContain("campus_services_release");
				expect(payload.answer.result.text).not.toContain("authenticated_notice:");
				expect(payload.answer.result.text).not.toContain("official_web:");
			}
			const lastMessage = payload.answer?.conversation?.messages?.at(-1);
			const tracePart = lastMessage?.structuredParts?.find(
				(part) => part.type === "campus_service_trace_cards",
			);
			expect(tracePart).toBeDefined();
			const tracePayload = JSON.stringify(tracePart ?? {});
			expect(tracePayload).not.toContain("authenticated_notice:");
			expect(tracePayload).not.toContain("official_web:");
			expect(tracePayload).not.toContain("release_id");
			expect(tracePayload).not.toContain("projection_internal_state");
			expect(tracePayload).not.toContain("table_parser_state");
			expect(tracePayload).toContain("title");
			expect(tracePayload).toContain("refs");
		}

		expect(supervisorExecute).toHaveBeenCalledTimes(CAMPUS_SERVICES_ROUTING_CASES.length);
		for (const [index, route] of CAMPUS_SERVICES_ROUTING_CASES.entries()) {
			const supervisorInput = supervisorExecute.mock.calls[index]?.[0];
			expect(supervisorInput).toMatchObject({
				requestedCapability: null,
				surface: "public_chat_web",
				userGoal: route.prompt,
			});
			expect(supervisorInput?.context.actor).toMatchObject({
				principalId: "user_01HQ",
				principalType: "student",
				userId: "user_01HQ",
			});

			expect(observedResults[index]).toMatchObject({
				allowed_tools: [route.expectedTool],
				payload_kind: route.expectedTool,
				target: "campus-services-agent",
				tool_result: {
					outcome: "resolved_current",
				},
			});

			const finalizedWrite = finalWrites[index] as FinalizeRequestWrite;
			expect(finalizedWrite.requestExecution).toMatchObject({
				diagnostics: {
					groundingVerdict: "supported",
					retrievedTitleSummary: [route.expectedTool],
					semanticOutcome: "resolved_current",
				},
				selectedTarget: "campus-services-agent",
				status: "completed",
				surface: "public_chat_web",
			});
			expect(finalizedWrite.assistantMessage).toMatchObject({
				kind: "answer",
				text: expect.stringContaining(route.expectedAnswerFragment),
			});
			const tracePart = finalizedWrite.assistantMessage.structuredParts.find(
				(part) => part.type === "campus_service_trace_cards",
			);
			expect(tracePart).toBeDefined();
		}
	});

	it("enforces campus-services clarification, fail-close, and no-action guardrails on the public chat path", async () => {
		const { store, finalWrites } = createCommandStore();
		const { store: conversationStore } = createConversationStore();
		const observedResults: Record<string, unknown>[] = [];
		const supervisorExecute = vi.fn(async (input: SupervisorExecutionInput) => {
			const currentCase = findCampusServicesGuardrailCase(input.userGoal);
			const response = buildCampusServicesGuardrailExecutionResponse(input, currentCase);
			observedResults.push(response.result as Record<string, unknown>);
			return response;
		});
		const executionRuntime: ExecutionControlRuntimeClient = {
			cancelRun: vi.fn(),
			createRun: vi.fn(async (input) =>
				durableRun({
					conversationId: input.conversationId,
					ownerUserId: input.ownerUserId,
					requestId: input.requestId,
					requestedCapability: input.requestedCapability ?? "",
					runId: input.runId,
					selectedCapability: input.selectedCapability ?? "",
					surface: input.surface,
					traceId: input.traceId ?? "",
					turnId: input.turnId,
				}),
			),
			getRun: vi.fn(),
			listRunEvents: vi.fn(async (input) => {
				const createInput = vi.mocked(executionRuntime.createRun).mock.calls.at(-1)?.[0];
				if (!createInput) {
					throw new Error("durable run was not created before event polling.");
				}
				const executionPayload = createInput.metadata.execution_payload as {
					context: unknown;
					request_id: string;
					trace: { trace_id: string };
					user_goal: string;
				};
				const response = await supervisorExecute({
					context: supervisorInputContextFromWire(executionPayload.context),
					conversationId: createInput.conversationId,
					requestId: executionPayload.request_id,
					requestedCapability: createInput.requestedCapability,
					requestedScope: null,
					safetyIdentifier: null,
					surface: createInput.surface,
					traceHeaders: createInput.traceHeaders,
					traceId: executionPayload.trace.trace_id,
					userGoal: executionPayload.user_goal,
					versionQuery: null,
				});
				return [
					durableFinalizationEvent({
						requestId: executionPayload.request_id,
						response,
						runId: input.runId,
						traceId: executionPayload.trace.trace_id,
					}),
				];
			}),
			listRunSteps: vi.fn(async () => ({ attempts: [], results: [], steps: [] })),
		};
		const chatCommandService = buildChatCommandService({
			conversationStore,
			durableEventPolling: {
				maxAttempts: 1,
				pollIntervalMs: 0,
			},
			executionRuntime,
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-04-27T10:00:00.000Z"),
			store,
		});
		const appApiEnv = {
			APP_API_NAME: "campus-agent-app-api",
			APP_API_ENVIRONMENT: "test" as const,
			BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
			PUBLIC_CHAT_WEB_ORIGIN: "https://chat.example.com",
			EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
			EXECUTION_CONTROL_SHARED_SECRET: "shared-secret",
			APP_API_OPERATOR_EMAIL_ALLOWLIST: "ops@example.com",
			APP_API_INTERNAL_SHARED_SECRET: "app-api-internal-secret",
			APP_API_DB: {
				connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
			},
		};
		const appApi = createAppApi(appApiEnv, {
			chatCommandService,
			getPrincipal: vi.fn().mockResolvedValue(createPrincipal()),
		});

		for (const currentCase of CAMPUS_SERVICES_GUARDRAIL_CASES) {
			const response = await worker.fetch(
				new Request("https://chat.example.com/api/chat/requests", {
					body: JSON.stringify({
						prompt: currentCase.prompt,
					}),
					headers: {
						"content-type": "application/json",
						cookie: "better-auth.session_token=test",
						"idempotency-key": `idem-guardrail-${currentCase.expectedTool}-${currentCase.expectedStatus}`,
					},
					method: "POST",
				}),
				{
					APP_API: {
						fetch: async (request: Request) => appApi.fetch(request, appApiEnv),
					},
					APP_API_BASE_URL: "https://app-api.internal",
					ASSETS: {
						fetch: async () =>
							new Response('<!doctype html><html><body><div id="root"></div></body></html>', {
								headers: {
									"content-type": "text/html; charset=utf-8",
								},
								status: 200,
							}),
					},
					PUBLIC_CHAT_HOSTNAME: "chat.example.com",
				},
			);
			const payload = (await response.json()) as {
				answer?: {
					conversation?: {
						messages?: Array<{
							structuredParts?: Array<{
								type?: string;
							}>;
						}>;
					};
					result?: {
						kind?: "answer" | "clarification" | "no_answer" | "error";
						message?: string;
						text?: string;
					};
				};
			};

			expect(response.status).toBe(200);
			expect(response.headers.get("cache-control")).toBe("no-store");
			expect(payload.answer?.result?.kind).toBe(currentCase.expectedResultKind);
			const resultText =
				currentCase.expectedResultKind === "error"
					? (payload.answer?.result?.message ?? "")
					: (payload.answer?.result?.text ?? "");
			expect(resultText).toBeTruthy();
			for (const fragment of currentCase.expectedTextFragments) {
				expect(resultText, `[${currentCase.name}] missing fragment`).toContain(fragment);
			}
			for (const fragment of currentCase.forbiddenTextFragments) {
				expect(resultText, `[${currentCase.name}] forbidden fragment`).not.toContain(fragment);
			}
			expect(resultText).not.toContain("projection_internal_state");
			expect(resultText).not.toContain("release_id");
			expect(resultText).not.toContain("authenticated_notice:");
			expect(resultText).not.toContain("official_web:");

			const lastMessage = payload.answer?.conversation?.messages?.at(-1);
			const tracePart = lastMessage?.structuredParts?.find(
				(part) => part.type === "campus_service_trace_cards",
			);
			if (currentCase.expectedResultKind === "answer") {
				expect(tracePart).toBeDefined();
			} else {
				expect(tracePart).toBeUndefined();
			}
		}

		expect(supervisorExecute).toHaveBeenCalledTimes(CAMPUS_SERVICES_GUARDRAIL_CASES.length);
		for (const [index, currentCase] of CAMPUS_SERVICES_GUARDRAIL_CASES.entries()) {
			const supervisorInput = supervisorExecute.mock.calls[index]?.[0];
			expect(supervisorInput).toMatchObject({
				requestedCapability: null,
				surface: "public_chat_web",
				userGoal: currentCase.prompt,
			});

			expect(observedResults[index]).toMatchObject({
				allowed_tools: [currentCase.expectedTool],
				payload_kind: currentCase.expectedTool,
				target: "campus-services-agent",
			});

			const finalizedWrite = finalWrites[index] as FinalizeRequestWrite;
			expect(finalizedWrite.requestExecution).toMatchObject({
				selectedTarget: "campus-services-agent",
				status: currentCase.expectedStatus,
				surface: "public_chat_web",
			});

			if (currentCase.expectedResultKind === "clarification") {
				expect(finalizedWrite.assistantMessage.kind).toBe("clarification");
			}
			if (currentCase.expectedResultKind === "no_answer") {
				expect(finalizedWrite.assistantMessage.kind).toBe("no_answer");
			}
			if (currentCase.expectedResultKind === "error") {
				expect(finalizedWrite.assistantMessage.kind).toBe("error");
			}
			if (currentCase.expectedResultKind === "answer") {
				expect(finalizedWrite.assistantMessage.kind).toBe("answer");
				const tracePart = finalizedWrite.assistantMessage.structuredParts.find(
					(part) => part.type === "campus_service_trace_cards",
				);
				expect(tracePart).toBeDefined();
			}
		}
	});
});
