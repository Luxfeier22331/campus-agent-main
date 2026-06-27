// @vitest-environment node

import { describe, expect, it } from "vitest";

import { type ChatE2eDependencies, runChatE2e } from "../scripts/chat-e2e";

function jsonResult<T>(
	payload: T,
	response = new Response("{}"),
): { payload: T; response: Response } {
	return {
		payload,
		response,
	};
}

function sseResponse(blocks: string[]): Response {
	return new Response(blocks.join(""), {
		headers: { "content-type": "text/event-stream" },
		status: 200,
	});
}

describe("chat e2e runner", () => {
	it("uses the durable stream chat request path by default", async () => {
		const jsonCalls: Array<{ method?: string; url: string }> = [];
		const streamCalls: Array<{ body: unknown; url: string }> = [];
		const result = await runChatE2e(
			[
				"--profile",
				"staging",
				"--chat-base-url",
				"https://campus.example.com",
				"--app-api-readyz-url",
				"https://api.example.com/readyz",
			],
			{
				APP_API_STAGING_SMOKE_AUTH_SECRET: "smoke-secret",
			} as NodeJS.ProcessEnv,
			{
				async fetchReadyz() {
					return {
						payload: { ok: true },
						status: 200,
					};
				},
				async fetchJsonWithCookie<T>(
					input: Parameters<NonNullable<ChatE2eDependencies["fetchJsonWithCookie"]>>[0],
				): Promise<{ payload: T; response: Response }> {
					jsonCalls.push({ method: input.method, url: input.url });
					if (input.url.endsWith("/api/me")) {
						return jsonResult({
							permissions: {
								chat: true,
								operator: false,
							},
							principal: {
								email: "help_bot@outlook.com",
								principalId: "user_staging",
								type: "user",
							},
							session: {
								expiresAt: "2099-01-01T00:00:00Z",
								sessionId: "session_staging",
							},
						} as T);
					}
					if (input.url.endsWith("/api/chat/conversations")) {
						return jsonResult({
							conversations: [{ id: "conv_01HQ", title: "Smoke" }],
						} as T);
					}
					if (input.url.endsWith("/api/chat/conversations/conv_01HQ")) {
						return jsonResult({
							conversation: {
								id: "conv_01HQ",
								messages: [
									{
										kind: "answer",
										requestId: "req_01HQ",
										role: "assistant",
										text: "国家奖学金每学年评审一次。",
									},
								],
							},
						} as T);
					}
					throw new Error(`unexpected json request: ${input.url}`);
				},
				async mintSmokeSession() {
					return "session=staging";
				},
				async openSubmitStream(input) {
					streamCalls.push({ body: input.body, url: input.url });
					return sseResponse([
						'event: request.accepted\ndata: {"occurredAt":"2026-06-04T00:00:00.000Z","requestId":"req_01HQ","runId":"run_01HQ","status":"accepted","traceId":"trace_01HQ"}\n\n',
						'event: request.completed\ndata: {"occurredAt":"2026-06-04T00:00:02.000Z","requestId":"req_01HQ","status":"completed","traceId":"trace_01HQ","answer":{"conversation":{"id":"conv_01HQ"},"result":{"kind":"answer","requestId":"req_01HQ","traceId":"trace_01HQ"}}}\n\n',
					]);
				},
			},
		);

		expect(result.passed).toBe(true);
		expect(result.request).toMatchObject({
			conversationId: "conv_01HQ",
			requestId: "req_01HQ",
			resultKind: "answer",
			runId: "run_01HQ",
			traceId: "trace_01HQ",
			transport: "stream",
		});
		expect(streamCalls).toEqual([
			{
				body: {
					prompt: "中央民族大学本科学生国家奖学金评审办法",
				},
				url: "https://campus.example.com/api/chat/requests/stream",
			},
		]);
		expect(jsonCalls).not.toContainEqual(
			expect.objectContaining({
				method: "POST",
				url: "https://campus.example.com/api/chat/requests",
			}),
		);
		expect(jsonCalls).toEqual(
			expect.arrayContaining([
				{ method: undefined, url: "https://campus.example.com/api/chat/conversations" },
				{ method: "GET", url: "https://campus.example.com/api/chat/conversations/conv_01HQ" },
			]),
		);
	});

	it("keeps the sync chat request path as an explicit diagnostic transport", async () => {
		const readyzUrls: string[] = [];
		const result = await runChatE2e(
			[
				"--profile",
				"staging",
				"--transport",
				"sync",
				"--chat-base-url",
				"https://campus.example.com",
				"--app-api-readyz-url",
				"https://api.example.com/readyz",
			],
			{
				APP_API_STAGING_SMOKE_AUTH_SECRET: "smoke-secret",
			} as NodeJS.ProcessEnv,
			{
				async fetchReadyz(url) {
					readyzUrls.push(url);
					return {
						payload: {
							ok: true,
						},
						status: 200,
					};
				},
				async fetchJsonWithCookie<T>(
					input: Parameters<NonNullable<ChatE2eDependencies["fetchJsonWithCookie"]>>[0],
				): Promise<{ payload: T; response: Response }> {
					if (input.url.endsWith("/api/me")) {
						return jsonResult({
							permissions: {
								chat: true,
								operator: false,
							},
							principal: {
								email: "help_bot@outlook.com",
								principalId: "user_staging",
								type: "user",
							},
							session: {
								expiresAt: "2099-01-01T00:00:00Z",
								sessionId: "session_staging",
							},
						} as T);
					}
					if (input.url.endsWith("/api/chat/conversations")) {
						return jsonResult({
							conversations:
								input.method === "POST" ? [] : [{ id: "conversation_staging", title: "Smoke" }],
						} as T);
					}
					return jsonResult(
						{
							answer: {
								conversation: {
									id: "conversation_staging",
								},
								result: {
									kind: "answer",
									requestId: "request_staging",
									traceId: "trace_staging",
								},
							},
						} as T,
						new Response("{}", {
							headers: {
								"x-request-id": "request_staging",
								"x-trace-id": "trace_staging",
							},
						}),
					);
				},
				async mintSmokeSession() {
					return "session=staging";
				},
			},
		);

		expect(result.passed).toBe(true);
		expect(result.request?.transport).toBe("sync");
		expect(result.readyz.exec).toBe(null);
		expect(readyzUrls).toEqual([
			"https://api.example.com/readyz",
			"https://campus.example.com/readyz",
		]);
	});

	it("classifies explicit exec readiness failure before minting a smoke session", async () => {
		let sessionMintCount = 0;
		const result = await runChatE2e(
			[
				"--profile",
				"staging",
				"--chat-base-url",
				"https://campus.example.com",
				"--app-api-readyz-url",
				"https://api.example.com/readyz",
				"--exec-readyz-url",
				"https://exec.example.com/readyz",
			],
			{
				APP_API_STAGING_SMOKE_AUTH_SECRET: "smoke-secret",
			} as NodeJS.ProcessEnv,
			{
				async fetchReadyz(url) {
					if (url === "https://exec.example.com/readyz") {
						return {
							payload: {
								error_code: 1033,
								error_name: "tunnel_error",
							},
							status: 530,
						};
					}
					return {
						payload: {
							ok: true,
						},
						status: 200,
					};
				},
				async fetchJsonWithCookie() {
					throw new Error("chat request should not run when readiness is blocked.");
				},
				async mintSmokeSession() {
					sessionMintCount += 1;
					return "session=unexpected";
				},
			},
		);

		expect(sessionMintCount).toBe(0);
		expect(result.passed).toBe(false);
		expect(result.blocked_by).toBe("execution_control_tunnel_unreachable");
		expect(result.chat_request_attempted).toBe(false);
		expect(result.session_mint_attempted).toBe(false);
		expect(result.readyz.exec?.status).toBe(530);
	});

	it("signs into a pre-provisioned dev smoke identity without using staging mint", async () => {
		let sessionMintCount = 0;
		let signInCount = 0;
		let signInCaptchaToken = "";
		const result = await runChatE2e(
			[
				"--profile",
				"dev",
				"--transport",
				"sync",
				"--chat-base-url",
				"http://127.0.0.1:27014",
				"--exec-readyz-url",
				"http://127.0.0.1:27051/readyz",
			],
			{
				APP_API_SMOKE_IDENTITY_CAPTCHA_TOKEN: "dev-captcha-token",
				APP_API_SMOKE_IDENTITY_PASSWORD: "dev-smoke-password",
			} as NodeJS.ProcessEnv,
			{
				async fetchReadyz() {
					return {
						payload: {
							status: "ready",
						},
						status: 200,
					};
				},
				async fetchJsonWithCookie<T>(
					input: Parameters<NonNullable<ChatE2eDependencies["fetchJsonWithCookie"]>>[0],
				): Promise<{ payload: T; response: Response }> {
					if (input.url.endsWith("/api/me")) {
						return jsonResult({
							permissions: {
								chat: true,
								operator: false,
							},
							principal: {
								email: "help_bot@outlook.com",
								principalId: "user_dev",
								type: "user",
							},
							session: {
								expiresAt: "2099-01-01T00:00:00Z",
								sessionId: "session_dev",
							},
						} as T);
					}
					if (input.url.endsWith("/api/chat/conversations")) {
						return jsonResult({
							conversations:
								input.method === "POST" ? [] : [{ id: "conversation_dev", title: "Smoke" }],
						} as T);
					}
					return jsonResult(
						{
							answer: {
								conversation: {
									id: "conversation_dev",
								},
								result: {
									kind: "answer",
									requestId: "request_dev",
									traceId: "trace_dev",
								},
							},
						} as T,
						new Response("{}", {
							headers: {
								"x-request-id": "request_dev",
								"x-trace-id": "trace_dev",
							},
						}),
					);
				},
				async mintSmokeSession() {
					sessionMintCount += 1;
					return "session=unexpected";
				},
				async signInSmokeIdentity(input) {
					signInCount += 1;
					signInCaptchaToken = input.captchaToken;
					return "session=dev";
				},
			},
		);

		expect(result.passed).toBe(true);
		expect(result.identity.resetViaDeployedRuntime).toBe(false);
		expect(result.session_mint_attempted).toBe(false);
		expect(result.sign_in_attempted).toBe(true);
		expect(result.readyz.appApi).toBe(null);
		expect(sessionMintCount).toBe(0);
		expect(signInCount).toBe(1);
		expect(signInCaptchaToken).toBe("dev-captcha-token");
	});

	it("requires the expected model execution state when requested", async () => {
		const observedRequestIds: string[] = [];
		const result = await runChatE2e(
			[
				"--profile",
				"dev",
				"--transport",
				"sync",
				"--chat-base-url",
				"http://127.0.0.1:27014",
				"--exec-readyz-url",
				"http://127.0.0.1:27051/readyz",
				"--expect-model-execution-state",
				"rag_sdk_completed",
			],
			{
				APP_API_SMOKE_IDENTITY_CAPTCHA_TOKEN: "dev-captcha-token",
				APP_API_SMOKE_IDENTITY_PASSWORD: "dev-smoke-password",
			} as NodeJS.ProcessEnv,
			{
				async fetchReadyz() {
					return {
						payload: {
							status: "ready",
						},
						status: 200,
					};
				},
				async fetchJsonWithCookie<T>(
					input: Parameters<NonNullable<ChatE2eDependencies["fetchJsonWithCookie"]>>[0],
				): Promise<{ payload: T; response: Response }> {
					if (input.url.endsWith("/api/me")) {
						return jsonResult({
							permissions: {
								chat: true,
								operator: false,
							},
							principal: {
								email: "help_bot@outlook.com",
								principalId: "user_dev",
								type: "user",
							},
							session: {
								expiresAt: "2099-01-01T00:00:00Z",
								sessionId: "session_dev",
							},
						} as T);
					}
					if (input.url.endsWith("/api/chat/conversations")) {
						return jsonResult({
							conversations:
								input.method === "POST" ? [] : [{ id: "conversation_dev", title: "Smoke" }],
						} as T);
					}
					return jsonResult(
						{
							answer: {
								conversation: {
									id: "conversation_dev",
								},
								result: {
									kind: "answer",
									requestId: "request_dev",
									traceId: "trace_dev",
								},
							},
						} as T,
						new Response("{}", {
							headers: {
								"x-request-id": "request_dev",
								"x-trace-id": "trace_dev",
							},
						}),
					);
				},
				async readModelExecutionState(requestId) {
					observedRequestIds.push(requestId);
					return "rag_sdk_completed";
				},
				async signInSmokeIdentity() {
					return "session=dev";
				},
			},
		);

		expect(result.passed).toBe(true);
		expect(observedRequestIds).toEqual(["request_dev"]);
		expect(result.request?.modelExecutionState).toBe("rag_sdk_completed");
	});

	it("fails closed when the expected model execution state is missing", async () => {
		await expect(
			runChatE2e(
				[
					"--profile",
					"dev",
					"--transport",
					"sync",
					"--chat-base-url",
					"http://127.0.0.1:27014",
					"--exec-readyz-url",
					"http://127.0.0.1:27051/readyz",
					"--expect-model-execution-state",
					"rag_sdk_completed",
				],
				{
					APP_API_SMOKE_IDENTITY_CAPTCHA_TOKEN: "dev-captcha-token",
					APP_API_SMOKE_IDENTITY_PASSWORD: "dev-smoke-password",
				} as NodeJS.ProcessEnv,
				{
					async fetchReadyz() {
						return {
							payload: {
								status: "ready",
							},
							status: 200,
						};
					},
					async fetchJsonWithCookie<T>(
						input: Parameters<NonNullable<ChatE2eDependencies["fetchJsonWithCookie"]>>[0],
					): Promise<{ payload: T; response: Response }> {
						if (input.url.endsWith("/api/me")) {
							return jsonResult({
								permissions: {
									chat: true,
									operator: false,
								},
								principal: {
									email: "help_bot@outlook.com",
									principalId: "user_dev",
									type: "user",
								},
								session: {
									expiresAt: "2099-01-01T00:00:00Z",
									sessionId: "session_dev",
								},
							} as T);
						}
						if (input.url.endsWith("/api/chat/conversations")) {
							return jsonResult({
								conversations:
									input.method === "POST" ? [] : [{ id: "conversation_dev", title: "Smoke" }],
							} as T);
						}
						return jsonResult(
							{
								answer: {
									conversation: {
										id: "conversation_dev",
									},
									result: {
										kind: "answer",
										requestId: "request_dev",
										traceId: "trace_dev",
									},
								},
							} as T,
							new Response("{}", {
								headers: {
									"x-request-id": "request_dev",
									"x-trace-id": "trace_dev",
								},
							}),
						);
					},
					async readModelExecutionState() {
						return null;
					},
					async signInSmokeIdentity() {
						return "session=dev";
					},
				},
			),
		).rejects.toThrow(
			"Expected model execution state rag_sdk_completed for request request_dev, received null.",
		);
	});
});
