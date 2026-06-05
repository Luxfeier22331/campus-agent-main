import { describe, expect, it, vi } from "vitest";

import worker from "../src/index";
import {
	EXPECTED_PUBLIC_CHAT_SECURITY_HEADERS,
	readPublicChatSecurityHeaders,
} from "./worker-shell-fixtures";

describe("public chat web app-api proxy", () => {
	it("proxies same-site api requests to app-api and forwards auth/body headers only", async () => {
		let forwardedBody: string | null = null;
		let forwardedBaggage: string | null = null;
		let forwardedCookie: string | null = null;
		let forwardedIdempotencyKey: string | null = null;
		let forwardedOrigin: string | null = null;
		let forwardedReferer: string | null = null;
		let forwardedSentryTrace: string | null = null;
		let forwardedTraceId: string | null = null;
		let forwardedUrl: string | null = null;

		const response = await worker.fetch(
			new Request("https://chat.example.com/api/chat/requests", {
				method: "POST",
				headers: {
					accept: "application/json",
					cookie: "better-auth.session_token=test",
					"content-type": "application/json",
					"idempotency-key": "idem-001",
					baggage: "sentry-environment=test",
					"sentry-trace": "0123456789abcdef0123456789abcdef-0123456789abcdef-1",
					origin: "https://chat.example.com",
					referer: "https://chat.example.com/chat",
					"x-spoofed-header": "drop-me",
					"x-trace-id": "trace-001",
				},
				body: JSON.stringify({
					conversationId: "conv_01HQ",
					prompt: "图书馆开放到几点？",
				}),
			}),
			{
				APP_API: {
					fetch: async (request: Request) => {
						forwardedBody = await request.text();
						forwardedBaggage = request.headers.get("baggage");
						forwardedCookie = request.headers.get("cookie");
						forwardedIdempotencyKey = request.headers.get("idempotency-key");
						forwardedOrigin = request.headers.get("origin");
						forwardedReferer = request.headers.get("referer");
						forwardedSentryTrace = request.headers.get("sentry-trace");
						forwardedTraceId = request.headers.get("x-trace-id");
						forwardedUrl = request.url;

						return new Response(
							JSON.stringify({
								answer: {
									result: {
										kind: "answer",
										requestId: "req_01HQ",
									},
								},
							}),
							{
								headers: {
									"content-type": "application/json; charset=utf-8",
									"x-request-id": "req_01HQ",
								},
								status: 200,
							},
						);
					},
				},
				APP_API_BASE_URL: "https://app-api.internal",
			},
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(readPublicChatSecurityHeaders(response)).toEqual(EXPECTED_PUBLIC_CHAT_SECURITY_HEADERS);
		expect(response.headers.get("x-request-id")).toBe("req_01HQ");
		await expect(response.json()).resolves.toEqual({
			answer: {
				result: {
					kind: "answer",
					requestId: "req_01HQ",
				},
			},
		});
		expect(forwardedUrl).toBe("https://app-api.internal/api/chat/requests");
		expect(forwardedCookie).toBe("better-auth.session_token=test");
		expect(forwardedIdempotencyKey).toBe("idem-001");
		expect(forwardedBaggage).toBe("sentry-environment=test");
		expect(forwardedOrigin).toBeNull();
		expect(forwardedReferer).toBeNull();
		expect(forwardedSentryTrace).toBe("0123456789abcdef0123456789abcdef-0123456789abcdef-1");
		expect(forwardedTraceId).toBe("trace-001");
		expect(forwardedBody).toBe(
			JSON.stringify({
				conversationId: "conv_01HQ",
				prompt: "图书馆开放到几点？",
			}),
		);
	});

	it("proxies answer feedback writes through the same-site app-api bridge", async () => {
		let forwardedBody: string | null = null;
		let forwardedUrl: string | null = null;

		const response = await worker.fetch(
			new Request(
				"https://chat.example.com/api/chat/conversations/conv_01HQ/messages/msg_assistant_01HQ/feedback",
				{
					body: JSON.stringify({
						reasonCodes: ["incorrect_answer"],
						vote: "unhelpful",
					}),
					headers: {
						cookie: "better-auth.session_token=test",
						"content-type": "application/json",
					},
					method: "PUT",
				},
			),
			{
				APP_API: {
					fetch: async (request: Request) => {
						forwardedBody = await request.text();
						forwardedUrl = request.url;

						return new Response(
							JSON.stringify({
								feedback: {
									createdAt: "2026-04-29T08:00:00.000Z",
									feedbackId: "fb_01HQ",
									messageId: "msg_assistant_01HQ",
									reasonCodes: ["incorrect_answer"],
									updatedAt: "2026-04-29T08:00:00.000Z",
									vote: "unhelpful",
								},
							}),
							{
								headers: {
									"content-type": "application/json; charset=utf-8",
								},
								status: 200,
							},
						);
					},
				},
				APP_API_BASE_URL: "https://app-api.internal",
			},
		);

		expect(response.status).toBe(200);
		expect(forwardedUrl).toBe(
			"https://app-api.internal/api/chat/conversations/conv_01HQ/messages/msg_assistant_01HQ/feedback",
		);
		expect(forwardedBody).toBe(
			JSON.stringify({
				reasonCodes: ["incorrect_answer"],
				vote: "unhelpful",
			}),
		);
	});

	it("proxies app-api lifecycle SSE responses without buffering or rewriting the stream", async () => {
		let forwardedAccept: string | null = null;
		let forwardedUrl: string | null = null;

		const response = await worker.fetch(
			new Request("https://chat.example.com/api/chat/requests/stream", {
				body: JSON.stringify({
					conversationId: "conv_01HQ",
					prompt: "图书馆开放到几点？",
				}),
				headers: {
					accept: "text/event-stream",
					"content-type": "application/json",
					cookie: "better-auth.session_token=test",
					"idempotency-key": "idem-stream-001",
				},
				method: "POST",
			}),
			{
				APP_API: {
					fetch: async (request: Request) => {
						forwardedAccept = request.headers.get("accept");
						forwardedUrl = request.url;

						return new Response(
							[
								'event: request.accepted\ndata: {"requestId":"req_stream_01HQ","traceId":"trace_stream_01HQ","status":"accepted"}',
								'event: request.completed\ndata: {"requestId":"req_stream_01HQ","traceId":"trace_stream_01HQ","status":"completed"}',
							].join("\n\n"),
							{
								headers: {
									"content-type": "text/event-stream; charset=utf-8",
									"x-request-id": "req_stream_01HQ",
								},
								status: 200,
							},
						);
					},
				},
				APP_API_BASE_URL: "https://app-api.internal",
			},
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("text/event-stream");
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(response.headers.get("x-request-id")).toBe("req_stream_01HQ");
		await expect(response.text()).resolves.toBe(
			[
				'event: request.accepted\ndata: {"requestId":"req_stream_01HQ","traceId":"trace_stream_01HQ","status":"accepted"}',
				'event: request.completed\ndata: {"requestId":"req_stream_01HQ","traceId":"trace_stream_01HQ","status":"completed"}',
			].join("\n\n"),
		);
		expect(forwardedAccept).toBe("text/event-stream");
		expect(forwardedUrl).toBe("https://app-api.internal/api/chat/requests/stream");
	});

	it("returns a contract-shaped dependency error when the app-api binding throws", async () => {
		const response = await worker.fetch(
			new Request("https://chat.example.com/api/chat/requests", {
				body: JSON.stringify({
					prompt: "图书馆开放到几点？",
				}),
				headers: {
					"content-type": "application/json",
				},
				method: "POST",
			}),
			{
				APP_API: {
					fetch: async () => {
						throw new Error("service binding failure");
					},
				},
				APP_API_BASE_URL: "https://app-api.internal",
				ASSETS: {
					fetch: async () => new Response("ok", { status: 200 }),
				},
				PUBLIC_CHAT_HOSTNAME: "chat.example.com",
			},
		);

		expect(response.status).toBe(503);
		await expect(response.json()).resolves.toEqual({
			error: {
				code: "dependency_not_ready",
				details: null,
				message: "App API upstream is unavailable.",
				requestId: null,
				retryable: true,
				traceId: null,
			},
		});
	});

	it("proxies the closed model catalog route through app-api instead of serving it locally", async () => {
		let forwardedUrl: string | null = null;
		const appApiFetch = vi.fn(async (request: Request) => {
			forwardedUrl = request.url;
			return new Response(JSON.stringify({ proxied: true }), {
				headers: {
					"cache-control": "private",
					"content-type": "application/json; charset=utf-8",
				},
				status: 200,
			});
		});
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(
				new Response("model catalog should not call external fetch", { status: 418 }),
			);

		try {
			const response = await worker.fetch(new Request("https://chat.example.com/api/models"), {
				APP_API: {
					fetch: appApiFetch,
				},
				APP_API_BASE_URL: "https://app-api.internal",
				ASSETS: {
					fetch: async () => new Response("ok", { status: 200 }),
				},
				PUBLIC_CHAT_HOSTNAME: "chat.example.com",
			});

			expect(response.status).toBe(200);
			expect(response.headers.get("cache-control")).toBe("no-store");
			expect(readPublicChatSecurityHeaders(response)).toEqual(
				EXPECTED_PUBLIC_CHAT_SECURITY_HEADERS,
			);
			await expect(response.json()).resolves.toEqual({ proxied: true });
			expect(forwardedUrl).toBe("https://app-api.internal/api/models");
			expect(appApiFetch).toHaveBeenCalledTimes(1);
			expect(fetchSpy).not.toHaveBeenCalled();
		} finally {
			fetchSpy.mockRestore();
		}
	});

	it("forwards origin and referer for same-site auth requests", async () => {
		let forwardedCookie: string | null = null;
		let forwardedCaptchaResponse: string | null = null;
		let forwardedOrigin: string | null = null;
		let forwardedReferer: string | null = null;
		let forwardedUrl: string | null = null;

		const response = await worker.fetch(
			new Request("https://chat.example.com/api/auth/sign-in/email", {
				method: "POST",
				headers: {
					accept: "application/json",
					cookie: "better-auth.session_token=test",
					"content-type": "application/json",
					origin: "https://chat.example.com",
					referer: "https://chat.example.com/login",
					"x-captcha-response": "captcha-token-01",
				},
				body: JSON.stringify({
					email: "jane@example.edu",
					password: "password12345",
				}),
			}),
			{
				APP_API: {
					fetch: async (request: Request) => {
						forwardedCookie = request.headers.get("cookie");
						forwardedCaptchaResponse = request.headers.get("x-captcha-response");
						forwardedOrigin = request.headers.get("origin");
						forwardedReferer = request.headers.get("referer");
						forwardedUrl = request.url;

						return new Response(JSON.stringify({ ok: true }), {
							headers: {
								"content-type": "application/json; charset=utf-8",
							},
							status: 200,
						});
					},
				},
				APP_API_BASE_URL: "https://app-api.internal",
			},
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ ok: true });
		expect(forwardedUrl).toBe("https://app-api.internal/api/auth/sign-in/email");
		expect(forwardedCookie).toBe("better-auth.session_token=test");
		expect(forwardedCaptchaResponse).toBe("captcha-token-01");
		expect(forwardedOrigin).toBe("https://chat.example.com");
		expect(forwardedReferer).toBe("https://chat.example.com/login");
	});

	it("fails closed when app-api binding is missing", async () => {
		const response = await worker.fetch(new Request("https://chat.example.com/api/me"), {
			APP_API_BASE_URL: "https://app-api.internal",
		});

		expect(response.status).toBe(503);
		await expect(response.json()).resolves.toEqual({
			error: {
				code: "dependency_not_ready",
				message: "App API binding is not configured.",
			},
		});
	});
});
