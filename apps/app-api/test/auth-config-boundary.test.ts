// @vitest-environment node

import { describe, expect, it } from "vitest";

import { readAppAuthConfig } from "../src/config";
import { buildRuntimeDatabaseConfig } from "../src/db/runtime";

describe("app-api auth config boundary", () => {
	it("reads auth runtime config without requiring supervisor transport or public-chat origin", () => {
		expect(
			readAppAuthConfig({
				APP_API_NAME: "campus-agent-app-api",
				APP_API_ENVIRONMENT: "test",
				BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
				AUTH_SHELL_ORIGIN: "https://campus.muc.wiki",
				AUTH_TURNSTILE_SECRET_KEY: "turnstile_secret_key",
				RESEND_API_KEY: "resend_test_key",
				AUTH_RESET_EMAIL_FROM: "Campus Agent <auth@example.com>",
				APP_API_END_USER_EMAIL_DOMAIN_ALLOWLIST: "muc.edu.cn",
			}),
		).toMatchObject({
			appName: "campus-agent-app-api",
			authShellOrigin: "https://campus.muc.wiki",
			publicChatOrigin: undefined,
			endUserEmailDomainAllowlist: ["muc.edu.cn"],
			endUserEmailAllowlist: [],
		});
	});

	it("requires AUTH_SHELL_ORIGIN instead of falling back to PUBLIC_CHAT_WEB_ORIGIN", () => {
		expect(() =>
			readAppAuthConfig({
				APP_API_NAME: "campus-agent-app-api",
				APP_API_ENVIRONMENT: "test",
				BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
				AUTH_TURNSTILE_SECRET_KEY: "turnstile_secret_key",
				RESEND_API_KEY: "resend_test_key",
				AUTH_RESET_EMAIL_FROM: "Campus Agent <auth@example.com>",
				PUBLIC_CHAT_WEB_ORIGIN: "https://chat.muc.wiki",
				APP_API_END_USER_EMAIL_DOMAIN_ALLOWLIST: "muc.edu.cn",
			}),
		).toThrow("Missing auth runtime configuration: AUTH_SHELL_ORIGIN");
	});

	it("requires APP_API_DB_FRESH for fresh runtime access instead of falling back to APP_API_DB", () => {
		expect(() =>
			buildRuntimeDatabaseConfig(
				{
					APP_API_ENVIRONMENT: "test",
					APP_API_DB: {
						connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
					},
				},
				{
					consistency: "fresh",
				},
			),
		).toThrow("APP_API_DB_FRESH.connectionString is required for fresh runtime access.");
	});
});
