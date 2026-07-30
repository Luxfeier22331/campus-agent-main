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
} from "../e2e/support/chat-e2e.args";

const E2E_CREDENTIAL_ARGS = [
	"--email",
	"smoke-user@example.edu",
	"--password",
	"dev-smoke-password",
	"--captcha-token",
	"dev-captcha-token",
];

describe("chat e2e args", () => {
	it("uses canonical staging profile defaults", () => {
		expect(parseChatE2eArgs(["--profile", "staging", ...E2E_CREDENTIAL_ARGS])).toEqual({
			appApiReadyzUrl: DEFAULT_CHAT_E2E_APP_API_READYZ_URL,
			captchaToken: "dev-captcha-token",
			chatBaseUrl: DEFAULT_CHAT_E2E_CHAT_BASE_URL,
			email: "smoke-user@example.edu",
			execReadyzUrl: null,
			expectModelExecutionState: null,
			expectResultKind: "answer",
			password: "dev-smoke-password",
			profile: "staging",
			prompt: DEFAULT_CHAT_E2E_PROMPT,
			transport: "stream",
		});
	});

	it("uses local endpoints for the local-provider profile", () => {
		expect(parseChatE2eArgs(["--profile", "local-provider", ...E2E_CREDENTIAL_ARGS])).toMatchObject(
			{
				appApiReadyzUrl: DEFAULT_LOCAL_CHAT_E2E_APP_API_READYZ_URL,
				captchaToken: "dev-captcha-token",
				chatBaseUrl: DEFAULT_LOCAL_CHAT_E2E_CHAT_BASE_URL,
				execReadyzUrl: DEFAULT_LOCAL_CHAT_E2E_EXEC_READYZ_URL,
				expectModelExecutionState: null,
				profile: "local-provider",
				transport: "stream",
			},
		);
	});

	it("uses campus-web readiness instead of direct app-api readiness for dev by default", () => {
		expect(parseChatE2eArgs(["--profile", "dev", ...E2E_CREDENTIAL_ARGS])).toMatchObject({
			appApiReadyzUrl: null,
			chatBaseUrl: DEFAULT_LOCAL_CHAT_E2E_CHAT_BASE_URL,
			execReadyzUrl: DEFAULT_LOCAL_CHAT_E2E_EXEC_READYZ_URL,
			captchaToken: "dev-captcha-token",
			expectModelExecutionState: null,
			profile: "dev",
			transport: "stream",
		});
	});

	it("accepts explicit target overrides without changing the profile contract", () => {
		expect(
			parseChatE2eArgs([
				"--profile",
				"dev",
				"--email",
				"smoke-user@example.edu",
				"--prompt",
				"民族学本科人才培养方案总学分要求是多少？",
				"--chat-base-url",
				"http://127.0.0.1:27014",
				"--app-api-readyz-url",
				"http://127.0.0.1:27031/readyz",
				"--exec-readyz-url",
				"http://127.0.0.1:27051/readyz",
				"--expect-result-kind",
				"any",
				"--expect-model-execution-state",
				"rag_sdk_completed",
				"--transport",
				"sync",
				"--password",
				"dev-smoke-password",
				"--captcha-token",
				"dev-captcha-token",
			]),
		).toEqual({
			appApiReadyzUrl: "http://127.0.0.1:27031/readyz",
			captchaToken: "dev-captcha-token",
			chatBaseUrl: "http://127.0.0.1:27014",
			email: "smoke-user@example.edu",
			execReadyzUrl: "http://127.0.0.1:27051/readyz",
			expectModelExecutionState: "rag_sdk_completed",
			expectResultKind: "any",
			password: "dev-smoke-password",
			profile: "dev",
			prompt: "民族学本科人才培养方案总学分要求是多少？",
			transport: "sync",
		});
	});

	it("rejects unsupported transports", () => {
		expect(() =>
			parseChatE2eArgs(["--profile", "staging", "--transport", "poll", ...E2E_CREDENTIAL_ARGS]),
		).toThrow("--transport must be one of: stream, sync.");
	});

	it("rejects unsupported profiles", () => {
		expect(() => parseChatE2eArgs(["--profile", "prod", ...E2E_CREDENTIAL_ARGS])).toThrow(
			"--profile must be one of: dev, local-provider, staging.",
		);
	});

	it("requires explicit login credentials", () => {
		expect(() => parseChatE2eArgs(["--profile", "staging"])).toThrow("--email is required.");
		expect(() =>
			parseChatE2eArgs(["--profile", "staging", "--email", "smoke-user@example.edu"]),
		).toThrow("--password is required.");
		expect(() =>
			parseChatE2eArgs([
				"--profile",
				"staging",
				"--email",
				"smoke-user@example.edu",
				"--password",
				"dev-smoke-password",
			]),
		).toThrow("--captcha-token is required.");
	});
});
