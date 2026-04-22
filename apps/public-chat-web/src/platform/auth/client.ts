import { createAuthClient } from "better-auth/react";

const authClient = createAuthClient();

export type AuthMode = "sign-in" | "sign-up";

export type AuthFormSubmission = {
	captchaToken: string;
	email: string;
	name: string;
	password: string;
};

export type PasswordRecoveryRequestSubmission = {
	captchaToken: string;
	email: string;
};

export type ResetPasswordSubmission = {
	newPassword: string;
	token: string;
};

export type AuthSubmissionErrorCode =
	| "captcha_required"
	| "failed"
	| "invalid_data"
	| "invalid_token"
	| "user_exists";

export type SignOutChatSessionOptions = {
	redirectTo?: string;
};

type ClientAuthResponse = {
	error?: {
		message?: string;
	} | null;
};

export class AuthSubmissionError extends Error {
	constructor(
		readonly code: AuthSubmissionErrorCode,
		message: string,
	) {
		super(message);
		this.name = "AuthSubmissionError";
	}
}

function readAuthErrorMessage(response: ClientAuthResponse | undefined, fallback: string): string {
	const message = response?.error?.message?.trim();
	return message || fallback;
}

function classifyAuthSubmissionError(mode: AuthMode, message: string): AuthSubmissionErrorCode {
	if (/captcha|verification failed|challenge/i.test(message)) {
		return "captcha_required";
	}

	if (mode === "sign-up" && /already exists|user exists|account exists/i.test(message)) {
		return "user_exists";
	}

	if (
		/invalid submission|validation|must be at least|required|invalid email|password must|too short/i.test(
			message,
		)
	) {
		return "invalid_data";
	}

	return "failed";
}

function classifyRecoveryError(message: string): AuthSubmissionErrorCode {
	if (/captcha|verification failed|challenge/i.test(message)) {
		return "captcha_required";
	}

	if (/invalid token|token.*invalid|token.*expired|expired token|invalid reset/i.test(message)) {
		return "invalid_token";
	}

	if (
		/invalid submission|validation|must be at least|required|invalid email|password must|too short/i.test(
			message,
		)
	) {
		return "invalid_data";
	}

	return "failed";
}

function resolvePasswordResetRedirectTarget(): string {
	if (typeof window === "undefined") {
		return "/reset-password";
	}

	return new URL("/reset-password", window.location.origin).toString();
}

function buildCaptchaHeaders(captchaToken: string): HeadersInit {
	return {
		"x-captcha-response": captchaToken,
	};
}

export async function submitEmailPasswordAuth(
	mode: AuthMode,
	values: AuthFormSubmission,
): Promise<void> {
	const response =
		mode === "sign-up"
			? await authClient.signUp.email({
					callbackURL: "/chat",
					email: values.email,
					fetchOptions: {
						headers: buildCaptchaHeaders(values.captchaToken),
					},
					name: values.name,
					password: values.password,
				})
			: await authClient.signIn.email({
					callbackURL: "/chat",
					email: values.email,
					fetchOptions: {
						headers: buildCaptchaHeaders(values.captchaToken),
					},
					password: values.password,
					rememberMe: true,
				});

	if (response?.error) {
		const message = readAuthErrorMessage(response, "认证请求失败。");
		throw new AuthSubmissionError(classifyAuthSubmissionError(mode, message), message);
	}
}

export async function requestPasswordReset(
	values: PasswordRecoveryRequestSubmission,
): Promise<void> {
	const response = await authClient.requestPasswordReset({
		email: values.email,
		fetchOptions: {
			headers: buildCaptchaHeaders(values.captchaToken),
		},
		redirectTo: resolvePasswordResetRedirectTarget(),
	});

	if (response?.error) {
		const message = readAuthErrorMessage(response, "发送重置邮件失败。");
		throw new AuthSubmissionError(classifyRecoveryError(message), message);
	}
}

export async function resetPasswordWithToken(values: ResetPasswordSubmission): Promise<void> {
	const response = await authClient.resetPassword({
		newPassword: values.newPassword,
		token: values.token,
	});

	if (response?.error) {
		const message = readAuthErrorMessage(response, "密码重置未完成。");
		throw new AuthSubmissionError(classifyRecoveryError(message), message);
	}
}

export async function signOutChatSession(options: SignOutChatSessionOptions = {}): Promise<void> {
	const { redirectTo } = options;
	const response = await authClient.signOut({
		fetchOptions: redirectTo
			? {
					onSuccess() {
						window.location.assign(redirectTo);
					},
				}
			: undefined,
	});
	if (response?.error) {
		throw new Error(readAuthErrorMessage(response, "暂时无法退出登录。"));
	}
}
