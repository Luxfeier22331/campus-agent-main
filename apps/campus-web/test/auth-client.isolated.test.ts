import { beforeEach, describe, expect, it, vi } from "vitest";
import authClientSource from "../src/platform/auth/client.ts?raw";

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

describe("campus auth client", () => {
	beforeEach(() => {
		for (const mock of Object.values(authClientMock)) {
			mock.mockReset();
		}
	});

	it("does not call the provider sign-up endpoint without legal consent", async () => {
		await expect(
			campusAuthClient.signUp.email({
				email: "student@example.edu",
				name: "student@example.edu",
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

		await expect(
			campusAuthClient.signUp.email({
				callbackURL: "/account",
				email: "student@example.edu",
				legalConsentAccepted: true,
				fetchOptions: {
					headers: {
						"x-captcha-response": "captcha-token",
					},
				},
				name: "student@example.edu",
				password: "password1234",
			}),
		).resolves.toEqual({});

		const signUpInput = authClientMock.signUpEmail.mock.calls[0]?.[0] as {
			fetchOptions?: { headers?: HeadersInit; throw?: boolean };
		};
		const headers = new Headers(signUpInput.fetchOptions?.headers);
		expect(headers.get("x-campus-legal-accepted")).toBe("terms-and-privacy");
		expect(headers.get("x-captcha-response")).toBe("captcha-token");
		expect(signUpInput).not.toHaveProperty("legalConsentAccepted");
	});

	it("preserves Better Auth UI throw mode for email sign-up errors", async () => {
		authClientMock.signUpEmail.mockResolvedValue({});

		await campusAuthClient.signUp.email({
			callbackURL: "/account",
			email: "student@example.edu",
			legalConsentAccepted: true,
			fetchOptions: {
				throw: true,
			},
			name: "student@example.edu",
			password: "password1234",
		});

		expect(authClientMock.signUpEmail).toHaveBeenCalledWith(
			expect.objectContaining({
				fetchOptions: expect.objectContaining({ throw: true }),
			}),
		);
	});

	it("localizes Better Auth thrown sign-up errors for mutation toasts", async () => {
		const upstreamError = Object.assign(new Error("User already exists"), {
			error: {
				code: "USER_ALREADY_EXISTS",
				message: "User already exists",
				status: 409,
				statusText: "Conflict",
			},
		});
		authClientMock.signUpEmail.mockRejectedValue(upstreamError);

		await expect(
			campusAuthClient.signUp.email({
				callbackURL: "/account",
				email: "student@example.edu",
				legalConsentAccepted: true,
				fetchOptions: {
					throw: true,
				},
				name: "student@example.edu",
				password: "password1234",
			}),
		).rejects.toMatchObject({
			error: expect.objectContaining({
				code: "USER_ALREADY_EXISTS",
				message: "这个邮箱已经注册，请直接登录。",
			}),
			message: "这个邮箱已经注册，请直接登录。",
		});
		expect(upstreamError.error.message).toBe("这个邮箱已经注册，请直接登录。");
	});

	it("localizes Better Fetch body errors for sign-up mutation toasts", async () => {
		const upstreamError = Object.assign(new Error("User already exists. Use another email."), {
			body: {
				data: null,
				error: {
					code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL",
					message: "User already exists. Use another email.",
					status: 422,
					statusText: "Unprocessable Entity",
				},
			},
		});
		authClientMock.signUpEmail.mockRejectedValue(upstreamError);

		await expect(
			campusAuthClient.signUp.email({
				callbackURL: "/account",
				email: "student@example.edu",
				legalConsentAccepted: true,
				fetchOptions: {
					throw: true,
				},
				name: "student@example.edu",
				password: "password1234",
			}),
		).rejects.toMatchObject({
			body: {
				error: expect.objectContaining({
					code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL",
					message: "这个邮箱已经注册，请直接登录。",
				}),
			},
			error: expect.objectContaining({
				code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL",
				message: "这个邮箱已经注册，请直接登录。",
			}),
			message: "这个邮箱已经注册，请直接登录。",
		});
		expect(upstreamError.body.error.message).toBe("这个邮箱已经注册，请直接登录。");
	});

	it("does not send legal consent headers for email sign-in", async () => {
		authClientMock.signInEmail.mockResolvedValue({});

		await campusAuthClient.signIn.email({
			callbackURL: "/account",
			email: "student@example.edu",
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

	it("does not wrap the Better Auth dynamic client in another Proxy", () => {
		expect(authClientSource).not.toContain("new Proxy");
	});

	it.each([
		[
			"end_user_email_not_allowed",
			"This email is not allowed for campus sign-in.",
			"当前邮箱暂不支持注册或登录。请使用学校邮箱，或联系维护者确认账号开放范围。",
		],
		["MISSING_RESPONSE", "Missing CAPTCHA response", "安全验证还没有完成，请稍后再试。"],
		["dependency_not_ready", "服务暂不可用，请稍后再试。", "服务暂不可用，请稍后再试。"],
		["INVALID_ORIGIN", "Invalid origin", "登录请求来源无效，请刷新页面后重试。"],
		["INVALID_EMAIL_OR_PASSWORD", "Invalid email or password", "邮箱或密码不正确。"],
		["USER_ALREADY_EXISTS", "User already exists", "这个邮箱已经注册，请直接登录。"],
		[
			"USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL",
			"User already exists. Use another email.",
			"这个邮箱已经注册，请直接登录。",
		],
		["UNKNOWN", "Upstream failure", "操作失败，请稍后重试。"],
	])("localizes Better Auth thrown errors for code %s", async (code, message, expected) => {
		const upstreamError = Object.assign(new Error(message), {
			error: {
				code,
				message,
				status: 400,
				statusText: "Bad Request",
			},
		});
		authClientMock.signInEmail.mockRejectedValue(upstreamError);

		await expect(
			campusAuthClient.signIn.email({
				callbackURL: "/account",
				email: "student@example.edu",
				password: "password1234",
			}),
		).rejects.toMatchObject({
			error: expect.objectContaining({
				code,
				message: expected,
			}),
			message: expected,
		});
	});

	it("throws localized resolved Better Auth error payloads for sign-up", async () => {
		authClientMock.signUpEmail.mockResolvedValue({
			data: null,
			error: {
				code: "MISSING_RESPONSE",
				message: "Missing CAPTCHA response",
				status: 400,
				statusText: "Bad Request",
			},
		});

		await expect(
			campusAuthClient.signUp.email({
				callbackURL: "/account",
				email: "student@example.edu",
				legalConsentAccepted: true,
				name: "student@example.edu",
				password: "password1234",
			}),
		).rejects.toMatchObject({
			error: expect.objectContaining({
				code: "MISSING_RESPONSE",
				message: "安全验证还没有完成，请稍后再试。",
			}),
			message: "安全验证还没有完成，请稍后再试。",
		});
	});
});
