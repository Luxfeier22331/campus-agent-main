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

import { campusAuthClient } from "../src/platform/auth/client";
import { setSignupLegalConsentAccepted } from "../src/platform/auth/legal-consent";

describe("campus auth client", () => {
	beforeEach(() => {
		for (const mock of Object.values(authClientMock)) {
			mock.mockReset();
		}
		setSignupLegalConsentAccepted(false);
	});

	it("does not call the provider sign-up endpoint without legal consent", async () => {
		await expect(
			campusAuthClient.signUp.email({
				email: "student@muc.edu.cn",
				name: "student@muc.edu.cn",
				password: "password1234",
				callbackURL: "/account",
			}),
		).resolves.toMatchObject({
			data: null,
			error: expect.objectContaining({
				code: "legal_consent_required",
			}),
		});
		expect(authClientMock.signUpEmail).not.toHaveBeenCalled();
	});

	it("preserves Better Auth UI fetch headers and adds legal consent for email sign-up", async () => {
		authClientMock.signUpEmail.mockResolvedValue({});
		setSignupLegalConsentAccepted(true);

		await expect(
			campusAuthClient.signUp.email({
				callbackURL: "/account",
				email: "student@muc.edu.cn",
				fetchOptions: {
					headers: {
						"x-captcha-response": "captcha-token",
					},
				},
				name: "student@muc.edu.cn",
				password: "password1234",
			}),
		).resolves.toEqual({});

		const signUpInput = authClientMock.signUpEmail.mock.calls[0]?.[0] as {
			fetchOptions?: { headers?: HeadersInit };
		};
		const headers = new Headers(signUpInput.fetchOptions?.headers);
		expect(headers.get("x-campus-legal-accepted")).toBe("terms-and-privacy");
		expect(headers.get("x-captcha-response")).toBe("captcha-token");
	});

	it("does not send legal consent headers for email sign-in", async () => {
		authClientMock.signInEmail.mockResolvedValue({});

		await campusAuthClient.signIn.email({
			callbackURL: "/account",
			email: "student@muc.edu.cn",
			fetchOptions: {
				headers: {
					"x-captcha-response": "captcha-token",
				},
			},
			password: "password1234",
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
