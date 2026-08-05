import { beforeEach, describe, expect, it, vi } from "vitest";
import authClientSource from "../src/platform/auth/client.ts?raw";

const authClientMock = vi.hoisted(() => ({
	requestPasswordReset: vi.fn(),
	resetPassword: vi.fn(),
	signInEmail: vi.fn(),
	signOut: vi.fn(),
	signUpEmail: vi.fn(),
}));
const authFetchHooks = vi.hoisted(() => ({
	onError: undefined as
		| ((context: { error: Error & Record<string, unknown>; response: Response }) => void)
		| undefined,
	onResponse: undefined as
		| ((context: { response: Response }) => Promise<Response | undefined>)
		| undefined,
}));

vi.mock("better-auth/react", () => ({
	createAuthClient: (options: {
		fetchOptions?: {
			onError?: typeof authFetchHooks.onError;
			onResponse?: typeof authFetchHooks.onResponse;
		};
	}) => {
		authFetchHooks.onError = options.fetchOptions?.onError;
		authFetchHooks.onResponse = options.fetchOptions?.onResponse;
		return {
			requestPasswordReset: authClientMock.requestPasswordReset,
			resetPassword: authClientMock.resetPassword,
			signIn: {
				email: authClientMock.signInEmail,
			},
			signOut: authClientMock.signOut,
			signUp: {
				email: authClientMock.signUpEmail,
			},
		};
	},
}));

vi.mock("@better-auth/oauth-provider/client", () => ({
	oauthProviderClient: () => ({ id: "oauth-provider-client" }),
}));

import { campusAuthClient, readCampusAuthRetryAfterSeconds } from "../src/platform/auth/client";

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
		).rejects.toMatchObject({
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
			"EMAIL_ACCESS_REQUIRED",
			"This email is not admitted.",
			"请使用 @muc.edu.cn 校园邮箱，或管理员已邀请的邮箱。",
		],
		["MISSING_RESPONSE", "Missing CAPTCHA response", "安全验证还没有完成，请稍后再试。"],
		["VERIFICATION_FAILED", "Captcha verification failed", "安全验证未通过，请重新完成验证。"],
		["UNKNOWN_ERROR", "Something went wrong", "安全验证服务暂时不可用，请稍后再试。"],
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

	it("preserves the server retry interval in rate-limited auth payloads", async () => {
		const response = new Response(JSON.stringify({ code: "TOO_MANY_REQUESTS" }), {
			headers: {
				"content-type": "application/json",
				"X-Retry-After": "23",
			},
			status: 429,
		});
		const normalizedResponse = (await authFetchHooks.onResponse?.({ response })) ?? response;
		const payload = await normalizedResponse.json();

		expect(payload).toMatchObject({
			code: "TOO_MANY_REQUESTS",
			retryAfterSeconds: 23,
		});
		expect(readCampusAuthRetryAfterSeconds({ error: payload })).toBe(23);
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
