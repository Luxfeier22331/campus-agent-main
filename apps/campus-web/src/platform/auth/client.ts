import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { inferAdditionalFields } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { CAMPUS_PASSWORD_MAX_LENGTH, CAMPUS_PASSWORD_MIN_LENGTH } from "campus-contracts/auth";

import {
	buildSignupLegalConsentHeaders,
	SIGNUP_LEGAL_CONSENT_FIELD_NAME,
	SIGNUP_LEGAL_CONSENT_REQUIRED_MESSAGE,
} from "./legal-consent";

const betterAuthClient = createAuthClient({
	fetchOptions: {
		async onResponse(context) {
			const retryAfterSeconds = readRetryAfterSeconds(context.response);
			if (!retryAfterSeconds) {
				return;
			}
			const payload = await context.response
				.clone()
				.json()
				.catch(() => null);
			if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
				return;
			}
			const headers = new Headers(context.response.headers);
			headers.delete("content-length");
			return new Response(JSON.stringify({ ...payload, retryAfterSeconds }), {
				headers,
				status: context.response.status,
				statusText: context.response.statusText,
			});
		},
		onError(context) {
			context.error.message = resolveUserFacingAuthErrorMessage({
				code: readAuthErrorCode(context.error),
				message: readAuthErrorMessage(context.error),
			});
		},
	},
	plugins: [
		oauthProviderClient(),
		inferAdditionalFields({
			user: {
				passwordChangeRequired: {
					defaultValue: false,
					input: false,
					required: true,
					type: "boolean",
				},
			},
		}),
	],
});

export {
	SIGNUP_LEGAL_CONSENT_FIELD_NAME,
	SIGNUP_LEGAL_CONSENT_HEADER_NAME,
	SIGNUP_LEGAL_CONSENT_HEADER_VALUE,
	SIGNUP_LEGAL_CONSENT_REQUIRED_MESSAGE,
} from "./legal-consent";

type BetterAuthClient = typeof betterAuthClient;
type BetterAuthSignUpEmail = BetterAuthClient["signUp"]["email"];
type BetterAuthSignInEmail = BetterAuthClient["signIn"]["email"];
type BetterAuthChangePassword = BetterAuthClient["changePassword"];
type CampusSignUpEmailInput = Parameters<BetterAuthSignUpEmail>[0] & {
	[SIGNUP_LEGAL_CONSENT_FIELD_NAME]?: unknown;
};
type CampusAuthClient = Omit<BetterAuthClient, "changePassword" | "signUp"> & {
	changePassword: (
		...args: Parameters<BetterAuthChangePassword>
	) => ReturnType<BetterAuthChangePassword>;
	signIn: Omit<BetterAuthClient["signIn"], "email"> & {
		email: (...args: Parameters<BetterAuthSignInEmail>) => ReturnType<BetterAuthSignInEmail>;
	};
	signUp: Omit<BetterAuthClient["signUp"], "email"> & {
		email: (input: CampusSignUpEmailInput) => ReturnType<BetterAuthSignUpEmail>;
	};
};

const USER_FACING_AUTH_ERROR_MESSAGES = {
	accountNotActive: "当前账号不可用，请联系维护者。",
	emailAlreadyVerified: "这个邮箱已经完成验证。",
	emailChangeUnavailable: "当前无法更换到这个邮箱。",
	emailInvalid: "请输入有效的邮箱地址。",
	emailNotAllowed: "该邮箱暂时无法使用，请检查邮箱地址后重试。",
	emailNotVerified: "请先完成邮箱验证。",
	emailOrPasswordInvalid: "邮箱或密码不正确。",
	emailRegistered: "这个邮箱已经注册，请直接登录。",
	generic: "操作失败，请稍后重试。",
	invalidOrigin: "登录请求来源无效，请刷新页面后重试。",
	invalidPassword: "当前密码不正确，或新密码不符合要求。",
	invalidToken: "操作链接无效或已经过期，请重新发起请求。",
	missingCaptcha: "安全验证还没有完成，请稍后再试。",
	captchaUnavailable: "安全验证服务暂时不可用，请稍后再试。",
	captchaVerificationFailed: "安全验证未通过，请重新完成验证。",
	passwordTooLong: `密码不能超过 ${CAMPUS_PASSWORD_MAX_LENGTH} 个字符。`,
	passwordTooShort: `密码至少需要 ${CAMPUS_PASSWORD_MIN_LENGTH} 个字符。`,
	temporaryPasswordExpired: "临时密码已经过期，请联系维护者重新签发。",
} as const;

function stringFromUnknown(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function readAuthErrorCode(error: unknown): string {
	if (error && typeof error === "object" && "code" in error) {
		return stringFromUnknown(error.code);
	}
	return "";
}

function readAuthErrorMessage(error: unknown): string {
	if (error && typeof error === "object" && "message" in error) {
		return stringFromUnknown(error.message);
	}
	return "";
}

function resolveUserFacingAuthErrorMessage(input: { code?: unknown; message?: unknown }): string {
	const code = stringFromUnknown(input.code);
	const message = stringFromUnknown(input.message);

	if (code === "EMAIL_ACCESS_REQUIRED") {
		return USER_FACING_AUTH_ERROR_MESSAGES.emailNotAllowed;
	}
	if (code === "EMAIL_NOT_VERIFIED") {
		return USER_FACING_AUTH_ERROR_MESSAGES.emailNotVerified;
	}
	if (code === "ACCOUNT_NOT_ACTIVE" || code === "BANNED_USER") {
		return USER_FACING_AUTH_ERROR_MESSAGES.accountNotActive;
	}
	if (code === "TEMPORARY_PASSWORD_EXPIRED") {
		return USER_FACING_AUTH_ERROR_MESSAGES.temporaryPasswordExpired;
	}
	if (code === "MISSING_RESPONSE") {
		return USER_FACING_AUTH_ERROR_MESSAGES.missingCaptcha;
	}
	if (code === "VERIFICATION_FAILED") {
		return USER_FACING_AUTH_ERROR_MESSAGES.captchaVerificationFailed;
	}
	if (code === "UNKNOWN_ERROR") {
		return USER_FACING_AUTH_ERROR_MESSAGES.captchaUnavailable;
	}
	if (code === "dependency_not_ready") {
		return message || USER_FACING_AUTH_ERROR_MESSAGES.generic;
	}
	if (code === "INVALID_ORIGIN") {
		return USER_FACING_AUTH_ERROR_MESSAGES.invalidOrigin;
	}
	if (code === "INVALID_EMAIL_OR_PASSWORD" || code === "USER_EMAIL_NOT_FOUND") {
		return USER_FACING_AUTH_ERROR_MESSAGES.emailOrPasswordInvalid;
	}
	if (code === "INVALID_PASSWORD") {
		return USER_FACING_AUTH_ERROR_MESSAGES.invalidPassword;
	}
	if (code === "PASSWORD_TOO_SHORT") {
		return USER_FACING_AUTH_ERROR_MESSAGES.passwordTooShort;
	}
	if (code === "PASSWORD_TOO_LONG") {
		return USER_FACING_AUTH_ERROR_MESSAGES.passwordTooLong;
	}
	if (code === "INVALID_TOKEN") {
		return USER_FACING_AUTH_ERROR_MESSAGES.invalidToken;
	}
	if (code === "INVALID_EMAIL") {
		return USER_FACING_AUTH_ERROR_MESSAGES.emailInvalid;
	}
	if (code === "EMAIL_ALREADY_VERIFIED") {
		return USER_FACING_AUTH_ERROR_MESSAGES.emailAlreadyVerified;
	}
	if (code === "EMAIL_MISMATCH" || code === "EMAIL_CAN_NOT_BE_UPDATED") {
		return USER_FACING_AUTH_ERROR_MESSAGES.emailChangeUnavailable;
	}
	if (
		code === "USER_ALREADY_EXISTS" ||
		code === "USER_EXISTS" ||
		code === "EMAIL_ALREADY_EXISTS" ||
		code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL"
	) {
		return USER_FACING_AUTH_ERROR_MESSAGES.emailRegistered;
	}
	return USER_FACING_AUTH_ERROR_MESSAGES.generic;
}

function localizeResolvedAuthResult<T>(result: T): T {
	if (!result || typeof result !== "object" || !("error" in result) || !result.error) {
		return result;
	}
	const error = result.error;
	const message = resolveUserFacingAuthErrorMessage({
		code: readAuthErrorCode(error),
		message: readAuthErrorMessage(error),
	});
	return {
		...result,
		error: {
			...(typeof error === "object" ? error : {}),
			message,
		},
	} as T;
}

export function throwCampusAuthResultError(result: unknown): never {
	const localized = localizeResolvedAuthResult(result);
	const error =
		localized && typeof localized === "object" && "error" in localized
			? localized.error
			: undefined;
	const message = readAuthErrorMessage(error) || USER_FACING_AUTH_ERROR_MESSAGES.generic;
	throw Object.assign(new Error(message), {
		error,
	});
}

function readObjectProperty(input: unknown, property: string): unknown {
	if (!input || typeof input !== "object" || !(property in input)) {
		return;
	}
	return input[property as keyof typeof input];
}

function readNestedAuthErrorPayload(error: unknown): unknown {
	const directError = readObjectProperty(error, "error");
	const nestedDirectError = readObjectProperty(directError, "error");
	if (nestedDirectError) {
		return nestedDirectError;
	}
	if (directError) {
		return directError;
	}
	const bodyError = readObjectProperty(readObjectProperty(error, "body"), "error");
	if (bodyError) {
		return bodyError;
	}
	return error;
}

export function readCampusAuthErrorCode(error: unknown): string {
	return readAuthErrorCode(readNestedAuthErrorPayload(error));
}

export function readCampusAuthErrorMessage(error: unknown): string {
	const nestedError = readNestedAuthErrorPayload(error);
	return (
		readAuthErrorMessage(nestedError) ||
		readAuthErrorMessage(error) ||
		USER_FACING_AUTH_ERROR_MESSAGES.generic
	);
}

export function readCampusAuthRetryAfterSeconds(error: unknown): number | undefined {
	const candidates = [error, readObjectProperty(error, "error"), readNestedAuthErrorPayload(error)];
	for (const candidate of candidates) {
		const value = readObjectProperty(candidate, "retryAfterSeconds");
		if (typeof value === "number" && Number.isFinite(value) && value > 0) {
			return Math.ceil(value);
		}
	}
	return;
}

function readRetryAfterSeconds(response: Response): number | undefined {
	if (response.status !== 429) {
		return;
	}
	const value = response.headers.get("X-Retry-After") ?? response.headers.get("Retry-After");
	if (!value) {
		return;
	}
	const seconds = Number(value);
	return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : undefined;
}

function localizeThrownAuthError(error: unknown): never {
	if (error && typeof error === "object") {
		const nestedError = readNestedAuthErrorPayload(error);
		const message = resolveUserFacingAuthErrorMessage({
			code: readAuthErrorCode(nestedError),
			message: readAuthErrorMessage(nestedError) || readAuthErrorMessage(error),
		});
		if ("message" in error) {
			try {
				Object.assign(error, { message });
			} catch {
				// Preserve the original thrown value if the message property is not writable.
			}
		}
		if (nestedError && typeof nestedError === "object") {
			Object.assign(nestedError, { message });
		}
		const directError = readObjectProperty(error, "error");
		if (directError && typeof directError === "object" && directError !== nestedError) {
			Object.assign(directError, { message });
		}
		if (!("error" in error) && nestedError && typeof nestedError === "object") {
			Object.assign(error, { error: nestedError });
		}
	}
	throw error;
}

function headersInitFromUnknown(headers: unknown): HeadersInit | undefined {
	if (
		headers === undefined ||
		headers instanceof Headers ||
		Array.isArray(headers) ||
		(typeof headers === "object" && headers !== null)
	) {
		return headers as HeadersInit | undefined;
	}
	return;
}

async function campusSignUpEmail(input: CampusSignUpEmailInput) {
	const { [SIGNUP_LEGAL_CONSENT_FIELD_NAME]: legalConsentAccepted, ...signUpInput } =
		input as CampusSignUpEmailInput;
	if (legalConsentAccepted !== true) {
		const error = {
			code: "legal_consent_required",
			message: SIGNUP_LEGAL_CONSENT_REQUIRED_MESSAGE,
			status: 400,
			statusText: "Bad Request",
		};
		throw Object.assign(new Error(SIGNUP_LEGAL_CONSENT_REQUIRED_MESSAGE), { error });
	}
	const fetchOptions = signUpInput.fetchOptions ?? {};
	try {
		const result = await betterAuthClient.signUp.email({
			...signUpInput,
			fetchOptions: {
				...fetchOptions,
				headers: buildSignupLegalConsentHeaders(headersInitFromUnknown(fetchOptions.headers)),
			},
		});
		if (result && typeof result === "object" && "error" in result && result.error) {
			throwCampusAuthResultError(result);
		}
		return localizeResolvedAuthResult(result) as Awaited<
			ReturnType<CampusAuthClient["signUp"]["email"]>
		>;
	} catch (error) {
		localizeThrownAuthError(error);
	}
}

async function campusSignInEmail(...args: Parameters<BetterAuthSignInEmail>) {
	try {
		const result = await betterAuthClient.signIn.email(...args);
		return localizeResolvedAuthResult(result) as Awaited<
			ReturnType<CampusAuthClient["signIn"]["email"]>
		>;
	} catch (error) {
		localizeThrownAuthError(error);
	}
}

async function campusChangePassword(...args: Parameters<BetterAuthChangePassword>) {
	const [input, fetchOptions] = args;
	const result = await betterAuthClient.changePassword(
		{ ...input, revokeOtherSessions: true },
		fetchOptions,
	);
	return result;
}

const campusSignIn = Object.assign(Object.create(betterAuthClient.signIn), {
	email: campusSignInEmail,
}) as CampusAuthClient["signIn"];

const campusSignUp = Object.assign(Object.create(betterAuthClient.signUp), {
	email: campusSignUpEmail,
}) as CampusAuthClient["signUp"];

export const campusAuthClient = Object.assign(Object.create(betterAuthClient), {
	changePassword: campusChangePassword,
	signIn: campusSignIn,
	signUp: campusSignUp,
}) as CampusAuthClient;
