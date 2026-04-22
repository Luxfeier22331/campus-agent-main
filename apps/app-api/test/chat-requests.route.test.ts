// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import { AppApiRouteError, type ChatCommandService } from "../src/modules/runtime-command";

const env = {
	APP_API_NAME: "campus-agent-app-api",
	APP_API_ENVIRONMENT: "test" as const,
	BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
	PUBLIC_CHAT_WEB_ORIGIN: "https://chat.example.com",
	SUPERVISOR_API_BASE_URL: "https://supervisor.internal",
	SUPERVISOR_API_SHARED_SECRET: "shared-secret",
	APP_API_DB: {
		connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
	},
};

function createCampusPrincipal() {
	return {
		actor: {
			departments: [],
			principalId: "user_01HQ",
			principalType: "campus_member",
			roles: ["campus_member"],
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
			type: "campus_member" as const,
		},
		session: {
			expiresAt: "2026-03-29T07:00:00.000Z",
			sessionId: "sess_01HQ",
		},
	};
}

describe("POST /api/chat/requests", () => {
	it("returns a product-layer answer payload plus request/trace headers", async () => {
		const service: ChatCommandService = {
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
		};
		const app = createApp(env, {
			chatCommandService: service,
			getPrincipal: vi.fn().mockResolvedValue(createCampusPrincipal()),
		});

		const response = await app.fetch(
			new Request("https://app-api.internal/api/chat/requests", {
				body: JSON.stringify({
					prompt: "图书馆开放到几点？",
				}),
				headers: {
					"content-type": "application/json",
					"idempotency-key": "idem-001",
				},
				method: "POST",
			}),
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("x-request-id")).toBe("req_01HQ");
		expect(response.headers.get("x-trace-id")).toBe("trace_01HQ");
		await expect(response.json()).resolves.toEqual({
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
		});
		expect(service.submit).toHaveBeenCalledWith({
			idempotencyKey: "idem-001",
			payload: {
				prompt: "图书馆开放到几点？",
			},
			principal: expect.objectContaining({
				principal: expect.objectContaining({
					principalId: "user_01HQ",
				}),
			}),
		});
	});

	it("fails closed when no principal is available", async () => {
		const app = createApp(env, {
			getPrincipal: vi.fn().mockResolvedValue(null),
		});

		const response = await app.fetch(
			new Request("https://app-api.internal/api/chat/requests", {
				body: JSON.stringify({
					prompt: "图书馆开放到几点？",
				}),
				headers: {
					"content-type": "application/json",
				},
				method: "POST",
			}),
		);

		expect(response.status).toBe(401);
		await expect(response.json()).resolves.toEqual({
			error: {
				code: "session_required",
				details: null,
				message: "Sign in required.",
				requestId: null,
				retryable: false,
				traceId: null,
			},
		});
	});

	it("maps service-level pre-accept errors onto the shared error envelope", async () => {
		const app = createApp(env, {
			chatCommandService: {
				submit: vi.fn().mockRejectedValue(
					new AppApiRouteError({
						code: "conversation_not_found",
						message: "Conversation not found.",
						retryable: false,
						status: 404,
					}),
				),
			},
			getPrincipal: vi.fn().mockResolvedValue(createCampusPrincipal()),
		});

		const response = await app.fetch(
			new Request("https://app-api.internal/api/chat/requests", {
				body: JSON.stringify({
					conversationId: "conv_missing",
					prompt: "图书馆开放到几点？",
				}),
				headers: {
					"content-type": "application/json",
				},
				method: "POST",
			}),
		);

		expect(response.status).toBe(404);
		expect(response.headers.get("x-request-id")).toMatch(/^req_[0-9a-f]{32}$/);
		expect(response.headers.get("x-trace-id")).toMatch(/^trace_[0-9a-f]{32}$/);
		await expect(response.json()).resolves.toEqual({
			error: {
				code: "conversation_not_found",
				details: null,
				message: "Conversation not found.",
				requestId: expect.stringMatching(/^req_[0-9a-f]{32}$/),
				retryable: false,
				traceId: expect.stringMatching(/^trace_[0-9a-f]{32}$/),
			},
		});
	});

	it("backfills correlation headers and envelope fields for route-level body validation failures", async () => {
		const app = createApp(env, {
			getPrincipal: vi.fn().mockResolvedValue(createCampusPrincipal()),
		});

		const response = await app.fetch(
			new Request("https://app-api.internal/api/chat/requests", {
				body: JSON.stringify({
					prompt: "图书馆开放到几点？",
				}),
				headers: {
					"content-type": "text/plain",
				},
				method: "POST",
			}),
		);

		expect(response.status).toBe(415);
		expect(response.headers.get("x-request-id")).toMatch(/^req_[0-9a-f]{32}$/);
		expect(response.headers.get("x-trace-id")).toMatch(/^trace_[0-9a-f]{32}$/);
		await expect(response.json()).resolves.toEqual({
			error: {
				code: "unsupported_media_type",
				details: null,
				message: "application/json is required.",
				requestId: expect.stringMatching(/^req_[0-9a-f]{32}$/),
				retryable: false,
				traceId: expect.stringMatching(/^trace_[0-9a-f]{32}$/),
			},
		});
	});

	it("backfills correlation headers and envelope fields for service-level validation failures", async () => {
		const app = createApp(env, {
			chatCommandService: {
				submit: vi.fn().mockRejectedValue(
					new AppApiRouteError({
						code: "validation_failed",
						details: { field: "prompt" },
						message: "prompt is required.",
						retryable: false,
						status: 422,
					}),
				),
			},
			getPrincipal: vi.fn().mockResolvedValue(createCampusPrincipal()),
		});

		const response = await app.fetch(
			new Request("https://app-api.internal/api/chat/requests", {
				body: JSON.stringify({}),
				headers: {
					"content-type": "application/json",
				},
				method: "POST",
			}),
		);

		expect(response.status).toBe(422);
		expect(response.headers.get("x-request-id")).toMatch(/^req_[0-9a-f]{32}$/);
		expect(response.headers.get("x-trace-id")).toMatch(/^trace_[0-9a-f]{32}$/);
		await expect(response.json()).resolves.toEqual({
			error: {
				code: "validation_failed",
				details: { field: "prompt" },
				message: "prompt is required.",
				requestId: expect.stringMatching(/^req_[0-9a-f]{32}$/),
				retryable: false,
				traceId: expect.stringMatching(/^trace_[0-9a-f]{32}$/),
			},
		});
	});
});

describe("POST /api/internal/evals/chat/requests", () => {
	it("accepts internal eval requests with shared secret and returns request correlation headers", async () => {
		const scheduleRequestProjectionDrain = vi.fn();
		const service: ChatCommandService = {
			submit: vi.fn().mockResolvedValue({
				answer: {
					conversation: {
						createdAt: "2026-03-28T07:59:00.000Z",
						id: "conv_eval_01HQ",
						messages: [],
						title: "图书馆开放时间",
						updatedAt: "2026-03-28T08:00:01.000Z",
					},
					result: {
						kind: "answer",
						requestId: "req_eval_01HQ",
						text: "图书馆开放到 22:00。",
						traceId: "trace_eval_01HQ",
					},
				},
				requestId: "req_eval_01HQ",
				supervisor: {
					answerText: "图书馆开放到 22:00。",
					error: null,
					followUpQuestion: "",
					observability: {
						aclAnomalyCode: null,
						aclDecision: null,
						cachedInputTokens: null,
						candidateCount: 3,
						citationCount: 1,
						citationExpected: true,
						citationMissing: false,
						estimatedCostMicrousd: 1234,
						failClosed: false,
						inputTokens: 120,
						modelName: "gpt-5.4",
						modelProvider: "openai",
						outputTokens: 42,
						refusalClass: null,
						retrievedSourceCount: 1,
						retrievalAttempted: true,
					},
					result: {
						evidence: {
							collection: "student_rules",
							corpus: "regulations",
							query_text: "图书馆开放到几点？",
							sources: [
								{
									anchor: { page: 1 },
									canonical_url: "https://example.edu/library-hours",
									chunk_id: "chunk-1",
									collection: "student_rules",
									doc_id: "handbook:library-hours",
									is_current: true,
									latest_url: "https://example.edu/library-hours",
									revision_track: "source-faithful",
									score: 0.98,
									snippet: "图书馆开放到 22:00。",
									source_channel: "pdf_ocr",
									source_title: "图书馆开放时间",
									version_id: "v1",
								},
							],
						},
					},
					selectedTarget: "rag-agent",
					status: "completed",
					traceId: "trace_eval_01HQ",
				},
				traceId: "trace_eval_01HQ",
			}),
		};
		const app = createApp(
			{
				...env,
				APP_API_INTERNAL_SHARED_SECRET: "trusted-secret",
			},
			{
				chatCommandService: service,
				scheduleRequestProjectionDrain,
			},
		);

		const response = await app.fetch(
			new Request("https://app-api.internal/api/internal/evals/chat/requests", {
				body: JSON.stringify({
					prompt: "图书馆开放到几点？",
					requestedScope: {
						corpus: "regulations",
						collection: "student_rules",
					},
				}),
				headers: {
					"content-type": "application/json",
					"x-app-internal-auth": "trusted-secret",
					"x-eval-user-email": "eval-benchmark@example.edu",
					"x-eval-user-id": "eval_user_01HQ",
					"x-eval-user-name": "Eval Benchmark",
				},
				method: "POST",
			}),
		);

		expect(response.status).toBe(200);
		expect(scheduleRequestProjectionDrain).not.toHaveBeenCalled();
		expect(response.headers.get("x-request-id")).toBe("req_eval_01HQ");
		expect(response.headers.get("x-trace-id")).toBe("trace_eval_01HQ");
		await expect(response.json()).resolves.toEqual({
			answer: {
				conversation: {
					createdAt: "2026-03-28T07:59:00.000Z",
					id: "conv_eval_01HQ",
					messages: [],
					title: "图书馆开放时间",
					updatedAt: "2026-03-28T08:00:01.000Z",
				},
				result: {
					kind: "answer",
					requestId: "req_eval_01HQ",
					text: "图书馆开放到 22:00。",
					traceId: "trace_eval_01HQ",
				},
			},
			supervisor: {
				answerText: "图书馆开放到 22:00。",
				error: null,
				followUpQuestion: "",
				observability: {
					aclAnomalyCode: null,
					aclDecision: null,
					cachedInputTokens: null,
					candidateCount: 3,
					citationCount: 1,
					citationExpected: true,
					citationMissing: false,
					estimatedCostMicrousd: 1234,
					failClosed: false,
					inputTokens: 120,
					modelName: "gpt-5.4",
					modelProvider: "openai",
					outputTokens: 42,
					refusalClass: null,
					retrievedSourceCount: 1,
					retrievalAttempted: true,
				},
				result: {
					evidence: {
						collection: "student_rules",
						corpus: "regulations",
						query_text: "图书馆开放到几点？",
						sources: [
							{
								anchor: { page: 1 },
								canonical_url: "https://example.edu/library-hours",
								chunk_id: "chunk-1",
								collection: "student_rules",
								doc_id: "handbook:library-hours",
								is_current: true,
								latest_url: "https://example.edu/library-hours",
								revision_track: "source-faithful",
								score: 0.98,
								snippet: "图书馆开放到 22:00。",
								source_channel: "pdf_ocr",
								source_title: "图书馆开放时间",
								version_id: "v1",
							},
						],
					},
				},
				selectedTarget: "rag-agent",
				status: "completed",
				traceId: "trace_eval_01HQ",
			},
		});
		expect(service.submit).toHaveBeenCalledWith({
			idempotencyKey: null,
			payload: {
				prompt: "图书馆开放到几点？",
				requestedScope: {
					corpus: "regulations",
					collection: "student_rules",
				},
			},
			principal: expect.objectContaining({
				actor: {
					departments: [],
					major: undefined,
					principalId: "eval_user_01HQ",
					principalType: "campus_member",
					program: undefined,
					roles: ["campus_member"],
					cohort: undefined,
					userId: "eval_user_01HQ",
				},
				permissions: {
					chat: true,
					operator: false,
				},
				principal: expect.objectContaining({
					principalId: "eval_user_01HQ",
					type: "campus_member",
				}),
			}),
			surface: "eval_benchmark",
		});
	});

	it("maps internal eval verified identity headers onto principal actor fields", async () => {
		const service: ChatCommandService = {
			submit: vi.fn().mockResolvedValue({
				answer: {
					conversation: {
						createdAt: "2026-03-28T07:59:00.000Z",
						id: "conv_eval_identity_01HQ",
						messages: [],
						title: "历史学强基计划培养方案",
						updatedAt: "2026-03-28T08:00:01.000Z",
					},
					result: {
						kind: "answer",
						requestId: "req_eval_identity_01HQ",
						text: "第四学期有大学英语(四)、中华民族共同体概论、中国近代边疆民族史料研读、世界现当代史。",
						traceId: "trace_eval_identity_01HQ",
					},
				},
				requestId: "req_eval_identity_01HQ",
				traceId: "trace_eval_identity_01HQ",
			}),
		};
		const app = createApp(
			{
				...env,
				APP_API_INTERNAL_SHARED_SECRET: "trusted-secret",
			},
			{
				chatCommandService: service,
			},
		);

		const response = await app.fetch(
			new Request("https://app-api.internal/api/internal/evals/chat/requests", {
				body: JSON.stringify({
					prompt: "我这个专业的基地班大二下有什么课",
					requestedScope: {
						corpus: "curriculum",
						collection: "curriculum_plan",
					},
				}),
				headers: {
					"content-type": "application/json",
					"x-app-internal-auth": "trusted-secret",
					"x-eval-user-email": "eval-benchmark@example.edu",
					"x-eval-user-id": "eval_user_01HQ",
					"x-eval-principal-type": "student",
					"x-eval-major": "b64:5Y6G5Y+y5a2m",
					"x-eval-program": "b64:5Y6G5Y+y5a2m5by65Z+66K6h5YiS",
					"x-eval-cohort": "2024",
				},
				method: "POST",
			}),
		);

		expect(response.status).toBe(200);
		expect(service.submit).toHaveBeenCalledWith({
			idempotencyKey: null,
			payload: {
				prompt: "我这个专业的基地班大二下有什么课",
				requestedScope: {
					collection: "curriculum_plan",
					corpus: "curriculum",
				},
			},
			principal: expect.objectContaining({
				actor: {
					departments: [],
					major: "历史学",
					principalId: "eval_user_01HQ",
					principalType: "student",
					program: "历史学强基计划",
					roles: ["campus_member", "student"],
					cohort: "2024",
					userId: "eval_user_01HQ",
				},
			}),
			surface: "eval_benchmark",
		});
	});

	it("fails closed when the internal shared secret is missing", async () => {
		const app = createApp({
			...env,
			APP_API_INTERNAL_SHARED_SECRET: "trusted-secret",
		});

		const response = await app.fetch(
			new Request("https://app-api.internal/api/internal/evals/chat/requests", {
				body: JSON.stringify({
					prompt: "图书馆开放到几点？",
				}),
				headers: {
					"content-type": "application/json",
				},
				method: "POST",
			}),
		);

		expect(response.status).toBe(401);
		await expect(response.json()).resolves.toEqual({
			error: {
				code: "service_credential_required",
				details: null,
				message: "Collector service credential required.",
				requestId: null,
				retryable: false,
				traceId: null,
			},
		});
	});
});
