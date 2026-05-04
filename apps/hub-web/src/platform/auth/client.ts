import { createAuthClient } from "better-auth/react";

export const hubAuthClient = createAuthClient();

export type HubAuthActionState =
	| "idle"
	| "success"
	| "failed"
	| "invalid_data"
	| "captcha_required"
	| "user_exists"
	| "invalid_token";

export interface HubEmailPasswordSubmission {
	captchaToken?: string;
	email: string;
	name?: string;
	password: string;
	returnTo?: string;
}

export interface HubPasswordRecoverySubmission {
	captchaToken?: string;
	email: string;
}

export interface HubResetPasswordSubmission {
	confirmPassword: string;
	newPassword: string;
	token: string;
}

export class HubAuthSubmissionError extends Error {
	readonly code: Exclude<HubAuthActionState, "idle" | "success">;

	constructor(code: Exclude<HubAuthActionState, "idle" | "success">, message: string) {
		super(message);
		this.code = code;
		this.name = "HubAuthSubmissionError";
	}
}

function readAuthErrorMessage(
	response: { error?: { message?: string } | null } | undefined,
	fallback: string,
): string {
	const message = response?.error?.message?.trim();
	return message || fallback;
}

function classifyAuthError(
	mode: "sign-in" | "sign-up",
	message: string,
): Exclude<HubAuthActionState, "idle" | "success"> {
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
): Exclude<HubAuthActionState, "idle" | "success" | "user_exists"> {
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

export async function signInWithEmail(input: HubEmailPasswordSubmission): Promise<void> {
	const response = await hubAuthClient.signIn.email({
		callbackURL: "/account",
		email: input.email,
		fetchOptions: input.captchaToken
			? { headers: { "x-captcha-response": input.captchaToken } }
			: undefined,
		password: input.password,
		rememberMe: true,
	});
	if (response?.error) {
		const message = readAuthErrorMessage(response, "登录失败。");
		throw new HubAuthSubmissionError(classifyAuthError("sign-in", message), message);
	}
}

export async function signUpWithEmail(input: HubEmailPasswordSubmission): Promise<void> {
	const response = await hubAuthClient.signUp.email({
		callbackURL: "/account",
		email: input.email,
		fetchOptions: input.captchaToken
			? { headers: { "x-captcha-response": input.captchaToken } }
			: undefined,
		name: input.name || input.email,
		password: input.password,
	});
	if (response?.error) {
		const message = readAuthErrorMessage(response, "注册失败。");
		throw new HubAuthSubmissionError(classifyAuthError("sign-up", message), message);
	}
}

export async function requestHubPasswordReset(input: HubPasswordRecoverySubmission): Promise<void> {
	const response = await hubAuthClient.requestPasswordReset({
		email: input.email,
		fetchOptions: input.captchaToken
			? { headers: { "x-captcha-response": input.captchaToken } }
			: undefined,
		redirectTo: "/account/reset-password",
	});
	if (response?.error) {
		const message = readAuthErrorMessage(response, "发送重置邮件失败。");
		throw new HubAuthSubmissionError(classifyRecoveryError(message), message);
	}
}

export async function resetHubPassword(input: HubResetPasswordSubmission): Promise<void> {
	if (input.newPassword !== input.confirmPassword) {
		throw new HubAuthSubmissionError("invalid_data", "两次输入的新密码不一致。");
	}

	const response = await hubAuthClient.resetPassword({
		newPassword: input.newPassword,
		token: input.token,
	});
	if (response?.error) {
		const message = readAuthErrorMessage(response, "密码重置失败。");
		throw new HubAuthSubmissionError(classifyRecoveryError(message), message);
	}
}

export async function signOutHubAccount(): Promise<void> {
	const response = await hubAuthClient.signOut();
	if (response?.error) {
		const message = readAuthErrorMessage(response, "退出登录失败。");
		throw new HubAuthSubmissionError("failed", message);
	}
}
