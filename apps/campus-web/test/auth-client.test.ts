import { beforeEach, describe, expect, it, vi } from "vitest";

const authClientMock = vi.hoisted(() => ({
	requestPasswordReset: vi.fn(),
	resetPassword: vi.fn(),
	signInEmail: vi.fn(),
	signOut: vi.fn(),
	signUpEmail: vi.fn(),
}));

vi.mock("better-auth/react", () => ({
	createAuthClient: () => ({
		requestPasswordReset: authClientMock.requestPasswordReset,
		resetPassword: authClientMock.resetPassword,
		signIn: {
			email: authClientMock.signInEmail,
		},
		signOut: authClientMock.signOut,
		signUp: {
			email: authClientMock.signUpEmail,
		},
	}),
}));

vi.mock("@better-auth/oauth-provider/client", () => ({
	oauthProviderClient: () => ({ id: "oauth-provider-client" }),
}));

import { signInWithEmail, signUpWithEmail } from "../src/platform/auth/client";

describe("campus auth client", () => {
	beforeEach(() => {
		for (const mock of Object.values(authClientMock)) {
			mock.mockReset();
		}
	});

	it("does not call the provider sign-up endpoint without legal consent", async () => {
		await expect(
			signUpWithEmail({
				email: "student@muc.edu.cn",
				name: "student@muc.edu.cn",
				password: "password1234",
				returnTo: "/account",
			}),
		).rejects.toMatchObject({ code: "legal_consent_required" });
		expect(authClientMock.signUpEmail).not.toHaveBeenCalled();
	});

	it("sends captcha and legal consent headers for email sign-up", async () => {
		authClientMock.signUpEmail.mockResolvedValue({});

		await expect(
			signUpWithEmail({
				captchaToken: "captcha-token",
				email: "student@muc.edu.cn",
				legalAccepted: true,
				name: "student@muc.edu.cn",
				password: "password1234",
				returnTo: "/account",
			}),
		).resolves.toEqual({ redirectedByProvider: false });

		expect(authClientMock.signUpEmail).toHaveBeenCalledWith(
			expect.objectContaining({
				fetchOptions: {
					headers: {
						"x-campus-legal-accepted": "terms-and-privacy",
						"x-captcha-response": "captcha-token",
					},
				},
			}),
		);
	});

	it("does not send legal consent headers for email sign-in", async () => {
		authClientMock.signInEmail.mockResolvedValue({});

		await signInWithEmail({
			captchaToken: "captcha-token",
			email: "student@muc.edu.cn",
			password: "password1234",
			returnTo: "/account",
		});

		expect(authClientMock.signInEmail).toHaveBeenCalledWith(
			expect.objectContaining({
				fetchOptions: {
					headers: {
						"x-captcha-response": "captcha-token",
					},
				},
			}),
		);
	});
});
