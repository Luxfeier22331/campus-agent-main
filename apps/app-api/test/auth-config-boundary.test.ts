// @vitest-environment node

import { describe, expect, it } from "vitest";

import { readAppAuthConfig, readAppAuthEmailConfig, resolveEnvironment } from "../src/config";
import { buildRuntimeDatabaseConfig } from "../src/db/runtime";

describe("app-api auth config boundary", () => {
	it("reads core auth config without requiring mail delivery or execution transport", () => {
		expect(
			readAppAuthConfig({
				DEPLOYMENT_ENVIRONMENT: "test",
				BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
				AUTH_SHELL_ORIGIN: "https://campus.muc.wiki",
				AUTH_TURNSTILE_SECRET_KEY: "turnstile_secret_key",
			}),
		).toMatchObject({
			appName: "campus-agent-app-api",
			authShellOrigin: "https://campus.muc.wiki",
		});
	});

	it("reads mail delivery config only when a mail flow needs it", () => {
		expect(
			readAppAuthEmailConfig({
				RESEND_API_KEY: "resend_test_key",
				AUTH_EMAIL_FROM: "Campus Agent <auth@example.com>",
			}),
		).toEqual({
			authEmailFrom: "Campus Agent <auth@example.com>",
			resendApiKey: "resend_test_key",
		});
		expect(() => readAppAuthEmailConfig({})).toThrow(
			"Missing auth email configuration: RESEND_API_KEY, AUTH_EMAIL_FROM",
		);
	});

	it("requires AUTH_SHELL_ORIGIN when the account shell origin is missing", () => {
		expect(() =>
			readAppAuthConfig({
				DEPLOYMENT_ENVIRONMENT: "test",
				BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
				AUTH_TURNSTILE_SECRET_KEY: "turnstile_secret_key",
			}),
		).toThrow("Missing auth runtime configuration: AUTH_SHELL_ORIGIN");
	});

	it("rejects a missing or unsupported runtime environment instead of defaulting", () => {
		expect(() => resolveEnvironment({})).toThrow("DEPLOYMENT_ENVIRONMENT must be one of");
		expect(() => resolveEnvironment({ DEPLOYMENT_ENVIRONMENT: "preview" })).toThrow(
			"DEPLOYMENT_ENVIRONMENT must be one of",
		);
	});

	it("requires the single APP_API_DB runtime binding", () => {
		expect(() =>
			buildRuntimeDatabaseConfig({
				DEPLOYMENT_ENVIRONMENT: "test",
			}),
		).toThrow("APP_API_DB.connectionString is required.");
	});
});
