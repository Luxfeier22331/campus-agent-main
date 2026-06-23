// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import type { ChatCommandService } from "../src/modules/runtime-command";

const env = {
	APP_API_NAME: "campus-agent-app-api",
	APP_API_ENVIRONMENT: "test" as const,
	BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
	AUTH_SHELL_ORIGIN: "https://campus.muc.wiki",
	EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
	EXECUTION_CONTROL_SHARED_SECRET: "shared-secret",
	APP_API_DB: {
		connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
	},
};

const inboundTraceHeaders = {
	baggage: "release=2026.06.18",
	sentryTrace: "0123456789abcdef0123456789abcdef-0123456789abcdef-1",
	traceParent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
};

const emptyTraceHeaders = {
	baggage: null,
	sentryTrace: null,
	traceParent: null,
};

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
				execution: {
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
					selectedCapability: "knowledge",
					status: "completed",
					traceId: "trace_eval_01HQ",
				},
				requestId: "req_eval_01HQ",
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
						collection: "student_rules",
						corpus: "regulations",
					},
					versionQuery: {
						compareToVersionId: "v2025-student-rules",
						mode: "compare",
						versionId: "v2024-student-rules",
					},
				}),
				headers: {
					baggage: inboundTraceHeaders.baggage,
					"content-type": "application/json",
					traceparent: inboundTraceHeaders.traceParent,
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
			execution: {
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
				selectedCapability: "knowledge",
				status: "completed",
				traceId: "trace_eval_01HQ",
			},
		});
		expect(service.submit).toHaveBeenCalledWith({
			idempotencyKey: null,
			payload: {
				prompt: "图书馆开放到几点？",
				requestedScope: {
					collection: "student_rules",
					corpus: "regulations",
				},
				versionQuery: {
					compareToVersionId: "v2025-student-rules",
					mode: "compare",
					versionId: "v2024-student-rules",
				},
			},
			principal: expect.objectContaining({
				actor: {
					cohort: undefined,
					departments: [],
					major: undefined,
					principalId: "eval_user_01HQ",
					principalType: "campus_member",
					program: undefined,
					roles: ["campus_member"],
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
			traceHeaders: { ...inboundTraceHeaders, sentryTrace: null },
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
						collection: "curriculum_plan",
						corpus: "curriculum",
					},
				}),
				headers: {
					"content-type": "application/json",
					"x-app-internal-auth": "trusted-secret",
					"x-eval-cohort": "2024",
					"x-eval-major": "b64:5Y6G5Y+y5a2m",
					"x-eval-principal-type": "student",
					"x-eval-program": "b64:5Y6G5Y+y5a2m5by65Z+66K6h5YiS",
					"x-eval-user-email": "eval-benchmark@example.edu",
					"x-eval-user-id": "eval_user_01HQ",
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
					cohort: "2024",
					departments: [],
					major: "历史学",
					principalId: "eval_user_01HQ",
					principalType: "student",
					program: "历史学强基计划",
					roles: ["campus_member", "student"],
					userId: "eval_user_01HQ",
				},
			}),
			surface: "eval_benchmark",
			traceHeaders: emptyTraceHeaders,
			waitUntil: undefined,
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
