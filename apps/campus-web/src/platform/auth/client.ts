import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { createAuthClient } from "better-auth/react";

export const campusAuthClient = createAuthClient({
	plugins: [oauthProviderClient()],
});

export type AccountAuthActionState =
	| "idle"
	| "success"
	| "failed"
	| "invalid_data"
	| "captcha_required"
	| "user_exists"
	| "invalid_token";

export interface AccountEmailPasswordSubmission {
	captchaToken?: string;
	email: string;
	name?: string;
	password: string;
	returnTo?: string;
}

export interface AccountPasswordRecoverySubmission {
	captchaToken?: string;
	email: string;
}

export interface AccountResetPasswordSubmission {
	confirmPassword: string;
	newPassword: string;
	token: string;
}

export interface AccountAuthSubmissionResult {
	redirectedByProvider: boolean;
}

export class AccountAuthSubmissionError extends Error {
	readonly code: Exclude<AccountAuthActionState, "idle" | "success">;

	constructor(code: Exclude<AccountAuthActionState, "idle" | "success">, message: string) {
		super(message);
		this.code = code;
		this.name = "AccountAuthSubmissionError";
	}
}

function readAuthErrorMessage(
	response: { error?: { message?: string } | null } | undefined,
	defaultMessage: string,
): string {
	const message = response?.error?.message?.trim();
	return message || defaultMessage;
}

function classifyAuthError(
	mode: "sign-in" | "sign-up",
	message: string,
): Exclude<AccountAuthActionState, "idle" | "success"> {
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

function classifyRecoveryError(
	message: string,
): Exclude<AccountAuthActionState, "idle" | "success" | "user_exists"> {
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

function hasProviderRedirect(response: unknown): boolean {
	if (!response || typeof response !== "object") {
		return false;
	}
	const data = (response as { data?: unknown }).data;
	return (
		Boolean(data) &&
		typeof data === "object" &&
		(data as { redirect?: unknown }).redirect === true &&
		typeof (data as { url?: unknown }).url === "string"
	);
}

export async function signInWithEmail(
	input: AccountEmailPasswordSubmission,
): Promise<AccountAuthSubmissionResult> {
	const response = await campusAuthClient.signIn.email({
		callbackURL: input.returnTo || "/account",
		email: input.email,
		fetchOptions: input.captchaToken
			? { headers: { "x-captcha-response": input.captchaToken } }
			: undefined,
		password: input.password,
		rememberMe: true,
	});
	if (response?.error) {
		const message = readAuthErrorMessage(response, "登录失败。");
		throw new AccountAuthSubmissionError(classifyAuthError("sign-in", message), message);
	}
	return {
		redirectedByProvider: hasProviderRedirect(response),
	};
}

export async function signUpWithEmail(
	input: AccountEmailPasswordSubmission,
): Promise<AccountAuthSubmissionResult> {
	const response = await campusAuthClient.signUp.email({
		callbackURL: input.returnTo || "/account",
		email: input.email,
		fetchOptions: input.captchaToken
			? { headers: { "x-captcha-response": input.captchaToken } }
			: undefined,
		name: input.name || input.email,
		password: input.password,
	});
	if (response?.error) {
		const message = readAuthErrorMessage(response, "注册失败。");
		throw new AccountAuthSubmissionError(classifyAuthError("sign-up", message), message);
	}
	return {
		redirectedByProvider: hasProviderRedirect(response),
	};
}

export async function requestAccountPasswordReset(
	input: AccountPasswordRecoverySubmission,
): Promise<void> {
	const response = await campusAuthClient.requestPasswordReset({
		email: input.email,
		fetchOptions: input.captchaToken
			? { headers: { "x-captcha-response": input.captchaToken } }
			: undefined,
		redirectTo: "/account/reset-password",
	});
	if (response?.error) {
		const message = readAuthErrorMessage(response, "发送重置邮件失败。");
		throw new AccountAuthSubmissionError(classifyRecoveryError(message), message);
	}
}

export async function resetAccountPassword(input: AccountResetPasswordSubmission): Promise<void> {
	if (input.newPassword !== input.confirmPassword) {
		throw new AccountAuthSubmissionError("invalid_data", "两次输入的新密码不一致。");
	}

	const response = await campusAuthClient.resetPassword({
		newPassword: input.newPassword,
		token: input.token,
	});
	if (response?.error) {
		const message = readAuthErrorMessage(response, "密码重置失败。");
		throw new AccountAuthSubmissionError(classifyRecoveryError(message), message);
	}
}

export async function signOutAccount(): Promise<void> {
	const response = await campusAuthClient.signOut();
	if (response?.error) {
		const message = readAuthErrorMessage(response, "退出登录失败。");
		throw new AccountAuthSubmissionError("failed", message);
	}
}
