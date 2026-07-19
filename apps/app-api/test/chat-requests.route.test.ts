// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import {
	AppApiRouteError,
	type ChatCommandService,
	type ChatCommandStreamEvent,
} from "../src/modules/runtime-command";

const env = {
	APP_API_NAME: "campus-agent-app-api",
	APP_API_ENVIRONMENT: "test" as const,
	BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
	AUTH_SHELL_ORIGIN: "https://campus.muc.wiki",
	EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
	APP_API_EXECUTION_SHARED_SECRET: "shared-secret",
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

const answerResponse = {
	answer: {
		conversation: {
			createdAt: "2026-03-28T07:59:00.000Z",
			id: "conv_01HQ",
			messages: [],
			title: "图书馆开放时间",
			updatedAt: "2026-03-28T08:00:01.000Z",
		},
		result: {
			kind: "answer" as const,
			requestId: "req_01HQ",
			text: "图书馆开放到 22:00。",
			traceId: "trace_01HQ",
		},
	},
	requestId: "req_01HQ",
	traceId: "trace_01HQ",
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
			submit: vi.fn().mockResolvedValue(answerResponse),
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
			requestKind: "public_chat",
			traceHeaders: emptyTraceHeaders,
			waitUntil: undefined,
		});
	});

	it("passes inbound W3C trace context to the chat command service", async () => {
		const service: ChatCommandService = {
			submit: vi.fn().mockResolvedValue(answerResponse),
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
					baggage: inboundTraceHeaders.baggage,
					"content-type": "application/json",
					"sentry-trace": inboundTraceHeaders.sentryTrace,
					traceparent: inboundTraceHeaders.traceParent,
				},
				method: "POST",
			}),
		);

		expect(response.status).toBe(200);
		expect(service.submit).toHaveBeenCalledWith(
			expect.objectContaining({
				traceHeaders: inboundTraceHeaders,
			}),
		);
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

	it("fails closed when JSON request body is not an object", async () => {
		const service: ChatCommandService = {
			submit: vi.fn(),
		};
		const app = createApp(env, {
			chatCommandService: service,
			getPrincipal: vi.fn().mockResolvedValue(createCampusPrincipal()),
		});

		const response = await app.fetch(
			new Request("https://app-api.internal/api/chat/requests", {
				body: JSON.stringify([]),
				headers: {
					"content-type": "application/json",
				},
				method: "POST",
			}),
		);

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toMatchObject({
			error: {
				code: "invalid_json_body",
				message: "JSON body must be an object.",
				retryable: false,
			},
		});
		expect(service.submit).not.toHaveBeenCalled();
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

describe("POST /api/chat/requests/stream", () => {
	it("writes SSE keepalive comments while waiting for durable lifecycle events", async () => {
		const service: ChatCommandService = {
			submit: vi.fn(),
			submitStream: vi.fn(async function* (): AsyncIterable<ChatCommandStreamEvent> {
				yield {
					data: {
						occurredAt: "2026-03-28T08:00:00.000Z",
						requestId: "req_stream_wait_01HQ",
						status: "accepted",
						traceId: "trace_stream_wait_01HQ",
					},
					event: "request.accepted",
				};
				await new Promise((resolve) => setTimeout(resolve, 100));
				yield {
					data: {
						answer: {
							conversation: {
								createdAt: "2026-03-28T07:59:00.000Z",
								id: "conv_wait_01HQ",
								messages: [],
								title: "图书馆开放时间",
								updatedAt: "2026-03-28T08:00:02.000Z",
							},
							result: {
								kind: "answer",
								requestId: "req_stream_wait_01HQ",
								text: "图书馆开放到 22:00。",
								traceId: "trace_stream_wait_01HQ",
							},
						},
						occurredAt: "2026-03-28T08:00:02.000Z",
						requestId: "req_stream_wait_01HQ",
						status: "completed",
						traceId: "trace_stream_wait_01HQ",
					},
					event: "request.completed",
				};
			}),
		};
		const app = createApp(env, {
			chatCommandService: service,
			getPrincipal: vi.fn().mockResolvedValue(createCampusPrincipal()),
		});

		const response = await app.fetch(
			new Request("https://app-api.internal/api/chat/requests/stream", {
				body: JSON.stringify({
					prompt: "图书馆开放到几点？",
				}),
				headers: {
					accept: "text/event-stream",
					"content-type": "application/json",
				},
				method: "POST",
			}),
		);

		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body.startsWith(": keepalive\n\n")).toBe(true);
		expect(body).toContain("event: request.completed");
	});

	it("streams product lifecycle events and terminal answer through app-api", async () => {
		const service: ChatCommandService = {
			submit: vi.fn(),
			submitStream: vi.fn(async function* (): AsyncIterable<ChatCommandStreamEvent> {
				yield {
					data: {
						occurredAt: "2026-03-28T08:00:00.000Z",
						requestId: "req_stream_01HQ",
						status: "accepted",
						traceId: "trace_stream_01HQ",
					},
					event: "request.accepted",
				};
				yield {
					data: {
						occurredAt: "2026-03-28T08:00:01.000Z",
						requestId: "req_stream_01HQ",
						status: "running",
						traceId: "trace_stream_01HQ",
					},
					event: "execution.running",
				};
				yield {
					data: {
						answer: {
							conversation: {
								createdAt: "2026-03-28T07:59:00.000Z",
								id: "conv_01HQ",
								messages: [],
								title: "图书馆开放时间",
								updatedAt: "2026-03-28T08:00:02.000Z",
							},
							result: {
								kind: "answer",
								requestId: "req_stream_01HQ",
								text: "图书馆开放到 22:00。",
								traceId: "trace_stream_01HQ",
							},
						},
						occurredAt: "2026-03-28T08:00:02.000Z",
						requestId: "req_stream_01HQ",
						status: "completed",
						traceId: "trace_stream_01HQ",
					},
					event: "request.completed",
				};
			}),
		};
		const app = createApp(env, {
			chatCommandService: service,
			getPrincipal: vi.fn().mockResolvedValue(createCampusPrincipal()),
		});

		const response = await app.fetch(
			new Request("https://app-api.internal/api/chat/requests/stream", {
				body: JSON.stringify({
					prompt: "图书馆开放到几点？",
				}),
				headers: {
					accept: "text/event-stream",
					baggage: inboundTraceHeaders.baggage,
					"content-type": "application/json",
					"idempotency-key": "idem-stream-001",
					traceparent: inboundTraceHeaders.traceParent,
				},
				method: "POST",
			}),
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("text/event-stream");
		expect(response.headers.get("cache-control")).toBe("no-store");
		const body = await response.text();
		expect(body).toContain("event: request.accepted");
		expect(body).toContain("event: execution.running");
		expect(body).toContain("event: request.completed");
		expect(body).toContain('"text":"图书馆开放到 22:00。"');
		expect(service.submitStream).toHaveBeenCalledWith({
			idempotencyKey: "idem-stream-001",
			payload: {
				prompt: "图书馆开放到几点？",
			},
			principal: expect.objectContaining({
				principal: expect.objectContaining({
					principalId: "user_01HQ",
				}),
			}),
			requestKind: "public_chat",
			traceHeaders: { ...inboundTraceHeaders, sentryTrace: null },
			waitUntil: undefined,
		});
	});
});
