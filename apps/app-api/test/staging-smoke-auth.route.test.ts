// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import type { Env } from "../src/config";
import { withRuntimeDatabase } from "../src/db/runtime";

const dbExecuteMock = vi.hoisted(() => vi.fn().mockResolvedValue({ rowCount: 1 }));

vi.mock("../src/db/runtime", async (importOriginal) => ({
	...(await importOriginal<typeof import("../src/db/runtime")>()),
	withRuntimeDatabase: vi.fn(async (_env, execute) =>
		execute({
			execute: dbExecuteMock,
		}),
	),
}));

const env: Env = {
	APP_API_NAME: "campus-agent-app-api",
	APP_API_ENVIRONMENT: "staging",
	APP_API_STAGING_SMOKE_AUTH_SECRET: "staging-smoke-secret",
	BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
	AUTH_SHELL_ORIGIN: "https://hub.muc.wiki",
	PUBLIC_CHAT_WEB_ORIGIN: "https://chat-staging.mucwiki-edge.link",
	EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
	EXECUTION_CONTROL_SHARED_SECRET: "shared-secret",
	APP_API_DB: {
		connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
	},
};

describe("POST /api/internal/staging-smoke/auth/session", () => {
	it("mints a deployed-runtime session only for the staging smoke credential", async () => {
		const signInEmail = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ redirect: false }), {
				headers: {
					"content-type": "application/json",
					"set-cookie":
						"__Secure-better-auth.session_token=signed-session; Path=/; HttpOnly; Secure; SameSite=Lax",
				},
				status: 200,
			}),
		);
		const app = createApp(env, {
			getAppAuth: vi.fn().mockResolvedValue({
				api: {
					signInEmail,
				},
			} as never),
		});

		const response = await app.fetch(
			new Request("https://app-api.internal/api/internal/staging-smoke/auth/session", {
				body: JSON.stringify({
					email: "HELP_BOT@OUTLOOK.COM",
					password: "SmokePass!123456",
				}),
				headers: {
					"content-type": "application/json",
					"x-app-staging-smoke-auth": "staging-smoke-secret",
				},
				method: "POST",
			}),
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(response.headers.get("set-cookie")).toContain(
			"__Secure-better-auth.session_token=signed-session",
		);
		expect(signInEmail).toHaveBeenCalledWith({
			asResponse: true,
			body: {
				email: "help_bot@outlook.com",
				password: "SmokePass!123456",
				rememberMe: true,
			},
			headers: expect.any(Headers),
			request: expect.any(Request),
		});
		const request = signInEmail.mock.calls[0]?.[0]?.request;
		expect(request.url).toBe("https://hub.muc.wiki/api/auth/sign-in/email");
		expect(request.headers.get("origin")).toBe("https://hub.muc.wiki");
	});

	it("fails closed outside staging", async () => {
		const signInEmail = vi.fn();
		const app = createApp(
			{
				...env,
				APP_API_ENVIRONMENT: "test",
			},
			{
				getAppAuth: vi.fn().mockResolvedValue({
					api: {
						signInEmail,
					},
				} as never),
			},
		);

		const response = await app.fetch(
			new Request("https://app-api.internal/api/internal/staging-smoke/auth/session", {
				body: JSON.stringify({
					email: "help_bot@outlook.com",
					password: "SmokePass!123456",
				}),
				headers: {
					"content-type": "application/json",
					"x-app-staging-smoke-auth": "staging-smoke-secret",
				},
				method: "POST",
			}),
		);

		expect(response.status).toBe(404);
		expect(signInEmail).not.toHaveBeenCalled();
	});

	it("rejects requests without the dedicated smoke secret", async () => {
		const signInEmail = vi.fn();
		const app = createApp(env, {
			getAppAuth: vi.fn().mockResolvedValue({
				api: {
					signInEmail,
				},
			} as never),
		});

		const response = await app.fetch(
			new Request("https://app-api.internal/api/internal/staging-smoke/auth/session", {
				body: JSON.stringify({
					email: "help_bot@outlook.com",
					password: "SmokePass!123456",
				}),
				headers: {
					"content-type": "application/json",
					"x-app-staging-smoke-auth": "wrong-secret",
				},
				method: "POST",
			}),
		);

		expect(response.status).toBe(401);
		expect(signInEmail).not.toHaveBeenCalled();
	});

	it("can reset the smoke identity before minting a session", async () => {
		dbExecuteMock.mockClear();
		vi.mocked(withRuntimeDatabase).mockClear();
		const signInEmail = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ redirect: false }), {
				headers: {
					"content-type": "application/json",
					"set-cookie":
						"__Secure-better-auth.session_token=signed-session; Path=/; HttpOnly; Secure; SameSite=Lax",
				},
				status: 200,
			}),
		);
		const app = createApp(
			{
				...env,
				APP_API_END_USER_EMAIL_ALLOWLIST: "help_bot@outlook.com",
			},
			{
				getAppAuth: vi.fn().mockResolvedValue({
					api: {
						signInEmail,
					},
				} as never),
			},
		);

		const response = await app.fetch(
			new Request("https://app-api.internal/api/internal/staging-smoke/auth/session", {
				body: JSON.stringify({
					email: "help_bot@outlook.com",
					name: "Campus Agent Smoke",
					password: "SmokePass!123456",
					resetIdentity: true,
				}),
				headers: {
					"content-type": "application/json",
					"x-app-staging-smoke-auth": "staging-smoke-secret",
				},
				method: "POST",
			}),
		);

		expect(response.status).toBe(200);
		expect(withRuntimeDatabase).toHaveBeenCalledOnce();
		expect(dbExecuteMock).toHaveBeenCalledTimes(4);
		expect(signInEmail).toHaveBeenCalledOnce();
	});
});
