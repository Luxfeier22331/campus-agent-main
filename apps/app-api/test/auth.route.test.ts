import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";

const env = {
	APP_API_DB: {
		connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
	},
	APP_API_EXECUTION_SHARED_SECRET: "shared-secret",
	AUTH_EMAIL_FROM: "Campus Agent <auth@example.com>",
	AUTH_SHELL_ORIGIN: "https://campus.muc.wiki",
	AUTH_TURNSTILE_SECRET_KEY: "turnstile_secret_key",
	BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
	DEPLOYMENT_ENVIRONMENT: "test" as const,
	EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
	RESEND_API_KEY: "resend_test_key",
};

function verificationRequest(callbackURL: string) {
	const url = new URL("https://campus.muc.wiki/api/auth/verify-email");
	url.searchParams.set("token", "verify-token");
	url.searchParams.set("callbackURL", callbackURL);
	return new Request(url);
}

describe("browser email verification route", () => {
	it("requires exactly one callback before consuming a verification token", async () => {
		const authHandler = vi.fn(() => Response.json({ status: true }));
		const app = createApp(env, { authHandler });
		const request = new Request("https://campus.muc.wiki/api/auth/verify-email?token=verify-token");

		const response = await app.fetch(request, env);

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toMatchObject({
			error: { code: "invalid_verification_callback" },
		});
		expect(authHandler).not.toHaveBeenCalled();
	});

	it("redirects admission failures to the product result page", async () => {
		const authHandler = vi.fn((_request: Request) =>
			Response.json(
				{ code: "EMAIL_ACCESS_REQUIRED", message: "This email is not admitted." },
				{ status: 403 },
			),
		);
		const app = createApp(env, { authHandler });

		const response = await app.fetch(
			verificationRequest("https://campus.muc.wiki/account/verify-email/result?redirectTo=%2Fmap"),
			env,
		);

		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBe(
			"https://campus.muc.wiki/account/verify-email/result?error=EMAIL_ACCESS_REQUIRED&redirectTo=%2Fmap",
		);
		expect(new URL(authHandler.mock.calls[0]?.[0].url ?? "https://invalid").pathname).toBe(
			"/verify-email",
		);
	});

	it("normalizes unknown verification failures without exposing internals", async () => {
		const app = createApp(env, {
			authHandler: vi.fn(() =>
				Response.json(
					{ code: "DATABASE_WRITE_FAILED", message: "internal detail" },
					{ status: 500 },
				),
			),
		});

		const response = await app.fetch(
			verificationRequest("https://campus.muc.wiki/account/settings/account"),
			env,
		);

		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBe(
			"https://campus.muc.wiki/account/verify-email/result?error=VERIFICATION_FAILED&redirectTo=%2Faccount%2Fsettings%2Faccount",
		);
	});

	it("normalizes Better Auth token-error redirects to the product result page", async () => {
		const callbackURL = "https://campus.muc.wiki/account/verify-email/result?redirectTo=%2Fdining";
		const app = createApp(env, {
			authHandler: vi.fn(
				() =>
					new Response(null, {
						headers: { location: `${callbackURL}&error=TOKEN_EXPIRED` },
						status: 302,
					}),
			),
		});

		const response = await app.fetch(verificationRequest(callbackURL), env);

		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBe(
			"https://campus.muc.wiki/account/verify-email/result?error=TOKEN_EXPIRED&redirectTo=%2Fdining",
		);
	});

	it.each([
		"https://attacker.example/account/verify-email/result",
		"https://campus.muc.wiki/api/auth/get-session",
		"https://campus.muc.wiki/account/deletion",
	])("rejects an unsafe verification callback before invoking Better Auth: %s", async (callbackURL) => {
		const authHandler = vi.fn(() => Response.json({ status: true }));
		const app = createApp(env, { authHandler });

		const response = await app.fetch(verificationRequest(callbackURL), env);

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toMatchObject({
			error: { code: "invalid_verification_callback" },
		});
		expect(authHandler).not.toHaveBeenCalled();
	});
});
