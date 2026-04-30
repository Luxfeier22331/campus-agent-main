// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
	DEFAULT_STAGING_APP_API_READYZ_URL,
	DEFAULT_STAGING_CHAT_BASE_URL,
	DEFAULT_STAGING_CHAT_SMOKE_PROMPT,
	DEFAULT_STAGING_EXEC_READYZ_URL,
	parseStagingChatSmokeArgs,
} from "../scripts/staging-chat-smoke.args";

describe("staging chat smoke args", () => {
	it("uses canonical staging defaults", () => {
		expect(
			parseStagingChatSmokeArgs([], {
				APP_API_STAGING_SMOKE_AUTH_SECRET: "smoke-secret",
			} as NodeJS.ProcessEnv),
		).toEqual({
			appApiReadyzUrl: DEFAULT_STAGING_APP_API_READYZ_URL,
			chatBaseUrl: DEFAULT_STAGING_CHAT_BASE_URL,
			email: "help_bot@outlook.com",
			execReadyzUrl: DEFAULT_STAGING_EXEC_READYZ_URL,
			expectResultKind: "answer",
			name: "Campus Agent Smoke",
			prompt: DEFAULT_STAGING_CHAT_SMOKE_PROMPT,
			smokeAuthSecret: "smoke-secret",
		});
	});

	it("accepts explicit staging overrides", () => {
		expect(
			parseStagingChatSmokeArgs(
				[
					"--",
					"--email",
					"smoke-user@example.edu",
					"--name",
					"Smoke User",
					"--prompt",
					"民族学本科人才培养方案总学分要求是多少？",
					"--chat-base-url",
					"https://chat.example.com",
					"--app-api-readyz-url",
					"https://api.example.com/readyz",
					"--exec-readyz-url",
					"https://exec.example.com/readyz",
					"--expect-result-kind",
					"any",
					"--smoke-auth-secret",
					"explicit-smoke-secret",
				],
				{} as NodeJS.ProcessEnv,
			),
		).toEqual({
			appApiReadyzUrl: "https://api.example.com/readyz",
			chatBaseUrl: "https://chat.example.com",
			email: "smoke-user@example.edu",
			execReadyzUrl: "https://exec.example.com/readyz",
			expectResultKind: "any",
			name: "Smoke User",
			prompt: "民族学本科人才培养方案总学分要求是多少？",
			smokeAuthSecret: "explicit-smoke-secret",
		});
	});

	it("rejects unsupported result kind expectations", () => {
		expect(() =>
			parseStagingChatSmokeArgs(["--expect-result-kind", "error"], {
				APP_API_STAGING_SMOKE_AUTH_SECRET: "smoke-secret",
			} as NodeJS.ProcessEnv),
		).toThrow("--expect-result-kind must be one of: answer, any.");
	});

	it("fails closed when no smoke auth secret is available", () => {
		expect(() => parseStagingChatSmokeArgs([], {} as NodeJS.ProcessEnv)).toThrow(
			"APP_API_STAGING_SMOKE_AUTH_SECRET",
		);
	});
});
