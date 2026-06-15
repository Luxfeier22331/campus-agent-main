// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
	DEFAULT_CHAT_E2E_APP_API_READYZ_URL,
	DEFAULT_CHAT_E2E_CHAT_BASE_URL,
	DEFAULT_CHAT_E2E_PROMPT,
	DEFAULT_LOCAL_CHAT_E2E_APP_API_READYZ_URL,
	DEFAULT_LOCAL_CHAT_E2E_CHAT_BASE_URL,
	DEFAULT_LOCAL_CHAT_E2E_EXEC_READYZ_URL,
	parseChatE2eArgs,
} from "../scripts/chat-e2e.args";

describe("chat e2e args", () => {
	it("uses canonical staging profile defaults", () => {
		expect(
			parseChatE2eArgs(["--profile", "staging"], {
				APP_API_STAGING_SMOKE_AUTH_SECRET: "smoke-secret",
			} as NodeJS.ProcessEnv),
		).toEqual({
			appApiReadyzUrl: DEFAULT_CHAT_E2E_APP_API_READYZ_URL,
			captchaToken: "",
			chatBaseUrl: DEFAULT_CHAT_E2E_CHAT_BASE_URL,
			email: "help_bot@outlook.com",
			execReadyzUrl: null,
			expectPromptRuntimeState: null,
			expectResultKind: "answer",
			name: "Campus Agent Smoke",
			password: "",
			profile: "staging",
			prompt: DEFAULT_CHAT_E2E_PROMPT,
			smokeAuthSecret: "smoke-secret",
			transport: "stream",
		});
	});

	it("uses local endpoints for the local-real-provider profile", () => {
		expect(
			parseChatE2eArgs(["--profile", "local-real-provider"], {
				APP_API_SMOKE_IDENTITY_CAPTCHA_TOKEN: "smoke-captcha-token",
				APP_API_SMOKE_IDENTITY_PASSWORD: "smoke-password",
			} as NodeJS.ProcessEnv),
		).toMatchObject({
			appApiReadyzUrl: DEFAULT_LOCAL_CHAT_E2E_APP_API_READYZ_URL,
			captchaToken: "smoke-captcha-token",
			chatBaseUrl: DEFAULT_LOCAL_CHAT_E2E_CHAT_BASE_URL,
			execReadyzUrl: DEFAULT_LOCAL_CHAT_E2E_EXEC_READYZ_URL,
			expectPromptRuntimeState: null,
			profile: "local-real-provider",
			transport: "stream",
		});
	});

	it("uses public-chat readiness instead of direct app-api readiness for dev by default", () => {
		expect(
			parseChatE2eArgs(["--profile", "dev"], {
				AUTH_TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
				APP_API_SMOKE_IDENTITY_PASSWORD: "smoke-password",
			} as NodeJS.ProcessEnv),
		).toMatchObject({
			appApiReadyzUrl: null,
			chatBaseUrl: DEFAULT_LOCAL_CHAT_E2E_CHAT_BASE_URL,
			execReadyzUrl: DEFAULT_LOCAL_CHAT_E2E_EXEC_READYZ_URL,
			captchaToken: "XXXX.DUMMY.TOKEN.XXXX",
			expectPromptRuntimeState: null,
			profile: "dev",
			transport: "stream",
		});
	});

	it("accepts explicit target overrides without changing the profile contract", () => {
		expect(
			parseChatE2eArgs(
				[
					"--profile",
					"dev",
					"--email",
					"smoke-user@example.edu",
					"--name",
					"Smoke User",
					"--prompt",
					"民族学本科人才培养方案总学分要求是多少？",
					"--chat-base-url",
					"http://127.0.0.1:27011",
					"--app-api-readyz-url",
					"http://127.0.0.1:27031/readyz",
					"--exec-readyz-url",
					"http://127.0.0.1:27051/readyz",
					"--expect-result-kind",
					"any",
					"--expect-prompt-runtime-state",
					"rag_sdk_completed",
					"--transport",
					"sync",
					"--password",
					"dev-smoke-password",
					"--captcha-token",
					"dev-captcha-token",
				],
				{} as NodeJS.ProcessEnv,
			),
		).toEqual({
			appApiReadyzUrl: "http://127.0.0.1:27031/readyz",
			captchaToken: "dev-captcha-token",
			chatBaseUrl: "http://127.0.0.1:27011",
			email: "smoke-user@example.edu",
			execReadyzUrl: "http://127.0.0.1:27051/readyz",
			expectPromptRuntimeState: "rag_sdk_completed",
			expectResultKind: "any",
			name: "Smoke User",
			password: "dev-smoke-password",
			profile: "dev",
			prompt: "民族学本科人才培养方案总学分要求是多少？",
			smokeAuthSecret: "",
			transport: "sync",
		});
	});

	it("rejects unsupported transports", () => {
		expect(() =>
			parseChatE2eArgs(["--profile", "staging", "--transport", "poll"], {
				APP_API_STAGING_SMOKE_AUTH_SECRET: "smoke-secret",
			} as NodeJS.ProcessEnv),
		).toThrow("--transport must be one of: stream, sync.");
	});

	it("rejects unsupported profiles", () => {
		expect(() =>
			parseChatE2eArgs(["--profile", "prod"], {
				APP_API_STAGING_SMOKE_AUTH_SECRET: "smoke-secret",
			} as NodeJS.ProcessEnv),
		).toThrow("--profile must be one of: dev, local-real-provider, staging.");
	});

	it("fails closed when no smoke auth secret is available", () => {
		expect(() => parseChatE2eArgs(["--profile", "staging"], {} as NodeJS.ProcessEnv)).toThrow(
			"APP_API_STAGING_SMOKE_AUTH_SECRET",
		);
	});

	it("fails closed when dev lacks a smoke identity password", () => {
		expect(() => parseChatE2eArgs(["--profile", "dev"], {} as NodeJS.ProcessEnv)).toThrow(
			"APP_API_SMOKE_IDENTITY_PASSWORD",
		);
	});

	it("fails closed when dev lacks captcha token outside the Turnstile test secret", () => {
		expect(() =>
			parseChatE2eArgs(["--profile", "dev"], {
				APP_API_SMOKE_IDENTITY_PASSWORD: "smoke-password",
				AUTH_TURNSTILE_SECRET_KEY: "cf-real-secret",
			} as NodeJS.ProcessEnv),
		).toThrow("APP_API_SMOKE_IDENTITY_CAPTCHA_TOKEN");
	});
});
