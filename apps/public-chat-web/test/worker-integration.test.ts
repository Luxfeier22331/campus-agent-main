import { describe, expect, it, vi } from "vitest";

import { createApp as createAppApi } from "../../app-api/src/app";
import type { SupervisorExecutionInput } from "../../app-api/src/modules/integration";
import {
	buildChatCommandService,
	createCommandStore,
	createConversationStore,
	createDeterministicIdGenerator,
	createPrincipal,
	type FinalizeRequestWrite,
	type SupervisorExecutionClient,
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

describe("public chat web chat integration", () => {
	it("smokes a chat request through public-chat-web into app-api", async () => {
		const appApiEnv = {
			APP_API_NAME: "campus-agent-app-api",
			APP_API_ENVIRONMENT: "test" as const,
			BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
			PUBLIC_CHAT_WEB_ORIGIN: "https://chat.example.com",
			SUPERVISOR_API_BASE_URL: "https://supervisor.internal",
			SUPERVISOR_API_SHARED_SECRET: "shared-secret",
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
		const supervisor: SupervisorExecutionClient = {
			execute: vi.fn(async (input: SupervisorExecutionInput) => {
				const route = findCampusServicesRoutingCase(input.userGoal);
				const response = buildCampusServicesExecutionResponse(input, route);
				observedResults.push(response.result as Record<string, unknown>);
				return response;
			}),
		};
		const chatCommandService = buildChatCommandService({
			conversationStore,
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-04-27T09:00:00.000Z"),
			store,
			supervisor,
		});
		const appApiEnv = {
			APP_API_NAME: "campus-agent-app-api",
			APP_API_ENVIRONMENT: "test" as const,
			BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
			PUBLIC_CHAT_WEB_ORIGIN: "https://chat.example.com",
			SUPERVISOR_API_BASE_URL: "https://supervisor.internal",
			SUPERVISOR_API_SHARED_SECRET: "shared-secret",
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

		expect(supervisor.execute).toHaveBeenCalledTimes(CAMPUS_SERVICES_ROUTING_CASES.length);
		for (const [index, route] of CAMPUS_SERVICES_ROUTING_CASES.entries()) {
			const supervisorInput = vi.mocked(supervisor.execute).mock.calls[index]?.[0];
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
		const supervisor: SupervisorExecutionClient = {
			execute: vi.fn(async (input: SupervisorExecutionInput) => {
				const currentCase = findCampusServicesGuardrailCase(input.userGoal);
				const response = buildCampusServicesGuardrailExecutionResponse(input, currentCase);
				observedResults.push(response.result as Record<string, unknown>);
				return response;
			}),
		};
		const chatCommandService = buildChatCommandService({
			conversationStore,
			generateId: createDeterministicIdGenerator(),
			now: () => new Date("2026-04-27T10:00:00.000Z"),
			store,
			supervisor,
		});
		const appApiEnv = {
			APP_API_NAME: "campus-agent-app-api",
			APP_API_ENVIRONMENT: "test" as const,
			BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
			PUBLIC_CHAT_WEB_ORIGIN: "https://chat.example.com",
			SUPERVISOR_API_BASE_URL: "https://supervisor.internal",
			SUPERVISOR_API_SHARED_SECRET: "shared-secret",
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

		expect(supervisor.execute).toHaveBeenCalledTimes(CAMPUS_SERVICES_GUARDRAIL_CASES.length);
		for (const [index, currentCase] of CAMPUS_SERVICES_GUARDRAIL_CASES.entries()) {
			const supervisorInput = vi.mocked(supervisor.execute).mock.calls[index]?.[0];
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
