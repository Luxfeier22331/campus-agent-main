// @vitest-environment node

import { describe, expect, it } from "vitest";

import { readAppAuthConfig } from "../src/config";
import { buildRuntimeDatabaseConfig } from "../src/db/runtime";

describe("app-api auth config boundary", () => {
	it("reads auth runtime config without requiring execution transport or campus-web origin", () => {
		expect(
			readAppAuthConfig({
				APP_API_ENVIRONMENT: "test",
				BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
				AUTH_SHELL_ORIGIN: "https://campus.muc.wiki",
				AUTH_TURNSTILE_SECRET_KEY: "turnstile_secret_key",
				RESEND_API_KEY: "resend_test_key",
				AUTH_EMAIL_FROM: "Campus Agent <auth@example.com>",
			}),
		).toMatchObject({
			appName: "campus-agent-app-api",
			authEmailFrom: "Campus Agent <auth@example.com>",
			authShellOrigin: "https://campus.muc.wiki",
		});
	});

	it("requires AUTH_SHELL_ORIGIN when the account shell origin is missing", () => {
		expect(() =>
			readAppAuthConfig({
				APP_API_ENVIRONMENT: "test",
				BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
				AUTH_TURNSTILE_SECRET_KEY: "turnstile_secret_key",
				RESEND_API_KEY: "resend_test_key",
				AUTH_EMAIL_FROM: "Campus Agent <auth@example.com>",
			}),
		).toThrow("Missing auth runtime configuration: AUTH_SHELL_ORIGIN");
	});

	it("requires the single APP_API_DB runtime binding", () => {
		expect(() =>
			buildRuntimeDatabaseConfig({
				APP_API_ENVIRONMENT: "test",
			}),
		).toThrow("APP_API_DB.connectionString is required.");
	});
});
