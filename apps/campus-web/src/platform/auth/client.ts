import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { createAuthClient } from "better-auth/react";

import {
	buildSignupLegalConsentHeaders,
	SIGNUP_LEGAL_CONSENT_FIELD_NAME,
	SIGNUP_LEGAL_CONSENT_REQUIRED_MESSAGE,
} from "./legal-consent";

const betterAuthClient = createAuthClient({
	plugins: [oauthProviderClient()],
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
type CampusSignUpEmailInput = Parameters<BetterAuthSignUpEmail>[0] & {
	[SIGNUP_LEGAL_CONSENT_FIELD_NAME]?: unknown;
};
type CampusAuthClient = Omit<BetterAuthClient, "signUp"> & {
	signIn: Omit<BetterAuthClient["signIn"], "email"> & {
		email: (...args: Parameters<BetterAuthSignInEmail>) => ReturnType<BetterAuthSignInEmail>;
	};
	signUp: Omit<BetterAuthClient["signUp"], "email"> & {
		email: (input: CampusSignUpEmailInput) => ReturnType<BetterAuthSignUpEmail>;
	};
};

const USER_FACING_AUTH_ERROR_MESSAGES = {
	emailNotAllowed: "当前邮箱暂不支持注册或登录。请使用学校邮箱，或联系维护者确认账号开放范围。",
	emailOrPasswordInvalid: "邮箱或密码不正确。",
	emailRegistered: "这个邮箱已经注册，请直接登录。",
	generic: "操作失败，请稍后重试。",
	invalidOrigin: "登录请求来源无效，请刷新页面后重试。",
	missingCaptcha: "安全验证还没有完成，请稍后再试。",
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
	const normalized = `${code} ${message}`.toLowerCase();

	if (code === "end_user_email_not_allowed" || normalized.includes("email is not allowed")) {
		return USER_FACING_AUTH_ERROR_MESSAGES.emailNotAllowed;
	}
	if (code === "MISSING_RESPONSE" || normalized.includes("missing captcha")) {
		return USER_FACING_AUTH_ERROR_MESSAGES.missingCaptcha;
	}
	if (code === "dependency_not_ready") {
		return message || USER_FACING_AUTH_ERROR_MESSAGES.generic;
	}
	if (code === "INVALID_ORIGIN" || normalized.includes("invalid origin")) {
		return USER_FACING_AUTH_ERROR_MESSAGES.invalidOrigin;
	}
	if (
		code === "INVALID_EMAIL_OR_PASSWORD" ||
		code === "UNAUTHORIZED" ||
		normalized.includes("invalid email or password") ||
		normalized.includes("invalid password") ||
		normalized.includes("unauthorized")
	) {
		return USER_FACING_AUTH_ERROR_MESSAGES.emailOrPasswordInvalid;
	}
	if (
		code === "USER_ALREADY_EXISTS" ||
		code === "USER_EXISTS" ||
		code === "EMAIL_ALREADY_EXISTS" ||
		code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL" ||
		normalized.includes("already exists") ||
		normalized.includes("already registered")
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

function throwLocalizedResolvedAuthError(result: unknown): never {
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
		return {
			data: null,
			error: {
				code: "legal_consent_required",
				message: SIGNUP_LEGAL_CONSENT_REQUIRED_MESSAGE,
				status: 400,
				statusText: "Bad Request",
			},
		} as Awaited<ReturnType<CampusAuthClient["signUp"]["email"]>>;
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
			throwLocalizedResolvedAuthError(result);
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

const campusSignIn = Object.assign(Object.create(betterAuthClient.signIn), {
	email: campusSignInEmail,
}) as CampusAuthClient["signIn"];

const campusSignUp = Object.assign(Object.create(betterAuthClient.signUp), {
	email: campusSignUpEmail,
}) as CampusAuthClient["signUp"];

export const campusAuthClient = Object.assign(Object.create(betterAuthClient), {
	signIn: campusSignIn,
	signUp: campusSignUp,
}) as CampusAuthClient;
