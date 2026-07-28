// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
	buildSmokeIdentityProvisionRuntimeEnv,
	provisionSmokeIdentity,
	readSmokeIdentityProvisionInput,
} from "../src/script-support/provisioning/provision-smoke-identity-lib.ts";

describe("app-api smoke identity provisioning", () => {
	it("requires a campus email and a password env var", () => {
		expect(() =>
			readSmokeIdentityProvisionInput(
				["--email", "not-allowed@example.com", "--name", "Smoke User"],
				{} as NodeJS.ProcessEnv,
			),
		).toThrow("must use a campus email");

		expect(() =>
			readSmokeIdentityProvisionInput(
				["--email", "smoke_test@muc.edu.cn", "--name", "Smoke User"],
				{
					APP_API_SCHEMA_DATABASE_URL: "postgresql://db.example/campus_agent",
				} as NodeJS.ProcessEnv,
			),
		).toThrow("APP_API_SMOKE_IDENTITY_PASSWORD is required");
	});

	it("builds a minimal app runtime env for canonical auth-route provisioning", () => {
		const input = readSmokeIdentityProvisionInput(
			["--email", "smoke_test@muc.edu.cn", "--name", "Smoke User"],
			{
				APP_API_ENVIRONMENT: "development",
				APP_API_SCHEMA_DATABASE_URL: "postgresql://db.example/campus_agent",
				APP_API_SMOKE_IDENTITY_PASSWORD: "SmokePass!2026",
			} as NodeJS.ProcessEnv,
		);

		expect(buildSmokeIdentityProvisionRuntimeEnv(input)).toMatchObject({
			APP_API_DB: {
				connectionString: "postgresql://db.example/campus_agent",
			},
			AUTH_TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
		});
	});

	it("rejects legacy management database input for smoke provisioning runtime env", () => {
		expect(() =>
			buildSmokeIdentityProvisionRuntimeEnv({
				appApiEnvironment: "development",
				authTurnstileSecretKey: "1x0000000000000000000000000000000AA",
				betterAuthSecret: "smoke-identity-secret-smoke-identity-secret",
				captchaToken: "XXXX.DUMMY.TOKEN.XXXX",
				databaseSslMode: "require",
				email: "smoke_test@muc.edu.cn",
				appApiExecutionSharedSecret: "smoke-identity-execution-secret",
				managementDatabaseUrl: "postgresql://legacy-management.example/campus_agent",
				name: "Smoke User",
				schemaDatabaseUrl: "",
				password: "SmokePass!2026",
				passwordEnvKey: "APP_API_SMOKE_IDENTITY_PASSWORD",
				authShellOrigin: "https://campus-staging.mucwiki-edge.link",
				executionControlBaseUrl: "https://execution-control.internal",
			}),
		).toThrow("schemaDatabaseUrl is required");
	});

	it("requires an explicit captcha token when not using the Cloudflare testing secret", () => {
		expect(() =>
			readSmokeIdentityProvisionInput(
				["--email", "smoke_test@muc.edu.cn", "--name", "Smoke User"],
				{
					APP_API_ENVIRONMENT: "staging",
					APP_API_SCHEMA_DATABASE_URL: "postgresql://db.example/campus_agent",
					APP_API_SMOKE_IDENTITY_PASSWORD: "SmokePass!2026",
					AUTH_TURNSTILE_SECRET_KEY: "cf-staging-secret",
				} as NodeJS.ProcessEnv,
			),
		).toThrow("APP_API_SMOKE_IDENTITY_CAPTCHA_TOKEN is required");
	});

	it("recreates the smoke identity through the real auth sign-up route after deleting prior rows", async () => {
		const executeSql = vi
			.fn()
			.mockResolvedValueOnce({ rowCount: 2 })
			.mockResolvedValueOnce({ rowCount: 1 })
			.mockResolvedValueOnce({ rowCount: 1 });
		const appFetch = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					user: {
						id: "user_123",
						email: "smoke_test@muc.edu.cn",
					},
				}),
				{
					headers: {
						"content-type": "application/json; charset=utf-8",
					},
					status: 200,
				},
			),
		);
		const input = readSmokeIdentityProvisionInput(
			["--email", "smoke_test@muc.edu.cn", "--name", "Smoke User"],
			{
				APP_API_ENVIRONMENT: "development",
				APP_API_SCHEMA_DATABASE_URL: "postgresql://db.example/campus_agent",
				APP_API_SMOKE_IDENTITY_PASSWORD: "SmokePass!2026",
			} as NodeJS.ProcessEnv,
		);

		const summary = await provisionSmokeIdentity(
			{
				...input,
				runtimeEnv: buildSmokeIdentityProvisionRuntimeEnv(input),
			},
			{
				appFetch,
				executeSql,
			},
		);

		expect(executeSql).toHaveBeenNthCalledWith(
			1,
			expect.stringContaining('delete from "chat"."conversations"'),
			["smoke_test@muc.edu.cn"],
		);
		expect(executeSql).toHaveBeenNthCalledWith(
			2,
			'delete from "app_auth"."user" where "email" = $1',
			["smoke_test@muc.edu.cn"],
		);
		expect(appFetch).toHaveBeenCalledWith(
			expect.objectContaining({
				method: "POST",
				url: "https://app-api.internal/api/auth/sign-up/email",
			}),
		);
		const signUpRequest = appFetch.mock.calls[0]?.[0];
		expect(signUpRequest).toBeInstanceOf(Request);
		expect((signUpRequest as Request).headers.get("x-captcha-response")).toBe(
			"XXXX.DUMMY.TOKEN.XXXX",
		);
		expect((signUpRequest as Request).headers.get("x-campus-legal-accepted")).toBe(
			"terms-and-privacy",
		);
		expect(executeSql).toHaveBeenNthCalledWith(
			3,
			'delete from "app_auth"."session" where "userId" = $1',
			["user_123"],
		);
		expect(summary).toEqual({
			clearedConversationCount: 2,
			clearedSessionCount: 1,
			deletedUserCount: 1,
			email: "smoke_test@muc.edu.cn",
			userId: "user_123",
		});
	});
});
