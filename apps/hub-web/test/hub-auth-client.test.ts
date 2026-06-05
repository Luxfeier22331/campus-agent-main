import { beforeEach, describe, expect, it, vi } from "vitest";

const oauthProviderClient = vi.fn(() => ({ id: "oauth-provider-client" }));
const signInEmail = vi.fn();
const signUpEmail = vi.fn();

vi.mock("@better-auth/oauth-provider/client", () => ({
	oauthProviderClient,
}));

vi.mock("better-auth/react", () => ({
	createAuthClient: vi.fn((config?: unknown) => ({
		__config: config,
		requestPasswordReset: vi.fn(),
		resetPassword: vi.fn(),
		signIn: {
			email: signInEmail,
		},
		signOut: vi.fn(),
		signUp: {
			email: signUpEmail,
		},
	})),
}));

describe("hub auth client OAuth federation continuity", () => {
	beforeEach(() => {
		signInEmail.mockReset();
		signUpEmail.mockReset();
	});

	it("mounts the Better Auth OAuth provider client plugin", async () => {
		const { createAuthClient } = await import("better-auth/react");

		await import("../src/platform/auth/client");

		expect(oauthProviderClient).toHaveBeenCalledTimes(1);
		expect(createAuthClient).toHaveBeenCalledWith({
			plugins: [{ id: "oauth-provider-client" }],
		});
	});

	it("passes the OAuth return target through sign-in callbackURL and preserves provider redirects", async () => {
		signInEmail.mockResolvedValue({
			data: {
				redirect: true,
				url: "https://hub.muc.wiki/api/federation/authorize?code=code_01HQ",
			},
			error: null,
		});
		const { signInWithEmail } = await import("../src/platform/auth/client");

		const result = await signInWithEmail({
			captchaToken: "turnstile_token",
			email: "jane@muc.edu.cn",
			password: "StrongPass!2026",
			returnTo: "/account/login?client_id=muc-wiki&sig=signed-oauth-query",
		});

		expect(signInEmail).toHaveBeenCalledWith({
			callbackURL: "/account/login?client_id=muc-wiki&sig=signed-oauth-query",
			email: "jane@muc.edu.cn",
			fetchOptions: {
				headers: {
					"x-captcha-response": "turnstile_token",
				},
			},
			password: "StrongPass!2026",
			rememberMe: true,
		});
		expect(result).toEqual({ redirectedByProvider: true });
	});

	it("passes the OAuth return target through sign-up callbackURL and preserves provider redirects", async () => {
		signUpEmail.mockResolvedValue({
			data: {
				redirect: true,
				url: "https://hub.muc.wiki/api/federation/authorize?code=code_01HQ",
			},
			error: null,
		});
		const { signUpWithEmail } = await import("../src/platform/auth/client");

		const result = await signUpWithEmail({
			email: "jane@muc.edu.cn",
			name: "Jane Doe",
			password: "StrongPass!2026",
			returnTo: "/account/register?client_id=muc-wiki&sig=signed-oauth-query",
		});

		expect(signUpEmail).toHaveBeenCalledWith({
			callbackURL: "/account/register?client_id=muc-wiki&sig=signed-oauth-query",
			email: "jane@muc.edu.cn",
			fetchOptions: undefined,
			name: "Jane Doe",
			password: "StrongPass!2026",
		});
		expect(result).toEqual({ redirectedByProvider: true });
	});
});
