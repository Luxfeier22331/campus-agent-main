// @vitest-environment node

import { describe, expect, it } from "vitest";

import { readAppAuthConfig } from "../src/config";

describe("app-api auth config boundary", () => {
	it("reads auth runtime config without requiring supervisor transport or public-chat origin", () => {
		expect(
			readAppAuthConfig({
				APP_API_NAME: "campus-agent-app-api",
				APP_API_ENVIRONMENT: "test",
				BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
				AUTH_SHELL_ORIGIN: "https://hub.muc.wiki",
				AUTH_TURNSTILE_SECRET_KEY: "turnstile_secret_key",
				RESEND_API_KEY: "resend_test_key",
				AUTH_RESET_EMAIL_FROM: "Campus Agent <auth@example.com>",
				APP_API_END_USER_EMAIL_DOMAIN_ALLOWLIST: "muc.edu.cn",
			}),
		).toMatchObject({
			appName: "campus-agent-app-api",
			authShellOrigin: "https://hub.muc.wiki",
			publicChatOrigin: undefined,
			endUserEmailDomainAllowlist: ["muc.edu.cn"],
			endUserEmailAllowlist: [],
		});
	});
});
