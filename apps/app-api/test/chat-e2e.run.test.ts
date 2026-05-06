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

describe("chat e2e runner", () => {
	it("classifies exec readiness failure before minting a smoke session", async () => {
		let sessionMintCount = 0;
		const result = await runChatE2e(
			[
				"--profile",
				"staging",
				"--chat-base-url",
				"https://chat.example.com",
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
		expect(result.blocked_by).toBe("supervisor_exec_tunnel_unreachable");
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
				"--chat-base-url",
				"http://127.0.0.1:27011",
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

	it("requires the expected prompt runtime state when requested", async () => {
		const observedRequestIds: string[] = [];
		const result = await runChatE2e(
			[
				"--profile",
				"dev",
				"--chat-base-url",
				"http://127.0.0.1:27011",
				"--exec-readyz-url",
				"http://127.0.0.1:27051/readyz",
				"--expect-prompt-runtime-state",
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
				async readPromptRuntimeState(requestId) {
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
		expect(result.request?.promptRuntimeState).toBe("rag_sdk_completed");
	});

	it("fails closed when the expected prompt runtime state is missing", async () => {
		await expect(
			runChatE2e(
				[
					"--profile",
					"dev",
					"--chat-base-url",
					"http://127.0.0.1:27011",
					"--exec-readyz-url",
					"http://127.0.0.1:27051/readyz",
					"--expect-prompt-runtime-state",
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
					async readPromptRuntimeState() {
						return null;
					},
					async signInSmokeIdentity() {
						return "session=dev";
					},
				},
			),
		).rejects.toThrow(
			"Expected prompt runtime state rag_sdk_completed for request request_dev, received null.",
		);
	});
});
