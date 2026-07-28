import { APIError } from "better-auth/api";

export const CAMPUS_EMAIL_DOMAIN = "muc.edu.cn";

export type CampusAccessDenialReason =
	| "account_banned"
	| "email_not_verified"
	| "invalid_email_domain"
	| "password_change_required";

export type CampusAccessDecision =
	| { allowed: true }
	| { allowed: false; reason: CampusAccessDenialReason };

export interface CampusAccessUser {
	banned?: boolean | null;
	email?: string | null;
	emailVerified?: boolean | null;
	passwordChangeRequired?: boolean | null;
}

export function assertAccountReady(user: CampusAccessUser): void {
	if (user.banned === true) {
		throw APIError.from("FORBIDDEN", {
			code: "BANNED_USER",
			message: "This account is banned.",
		});
	}
	if (user.passwordChangeRequired === true) {
		throw APIError.from("FORBIDDEN", {
			code: "PASSWORD_CHANGE_REQUIRED",
			message: "The password must be changed before continuing.",
		});
	}
}

export function normalizeCampusEmail(value: string | null | undefined): string | null {
	if (typeof value !== "string") {
		return null;
	}

	const normalized = value.trim().toLowerCase();
	const separator = normalized.lastIndexOf("@");
	if (
		separator <= 0 ||
		separator !== normalized.indexOf("@") ||
		separator === normalized.length - 1
	) {
		return null;
	}

	return normalized;
}

export function isCampusEmail(value: string | null | undefined): boolean {
	const email = normalizeCampusEmail(value);
	return email?.slice(email.lastIndexOf("@") + 1) === CAMPUS_EMAIL_DOMAIN;
}

export function evaluateCampusAccess(user: CampusAccessUser): CampusAccessDecision {
	if (!isCampusEmail(user.email)) {
		return { allowed: false, reason: "invalid_email_domain" };
	}
	if (user.emailVerified !== true) {
		return { allowed: false, reason: "email_not_verified" };
	}
	if (user.banned === true) {
		return { allowed: false, reason: "account_banned" };
	}
	if (user.passwordChangeRequired === true) {
		return { allowed: false, reason: "password_change_required" };
	}

	return { allowed: true };
}

export function assertCampusUserEligible(user: CampusAccessUser): void {
	const decision = evaluateCampusAccess(user);
	if (decision.allowed) {
		return;
	}

	const error =
		decision.reason === "email_not_verified"
			? {
					code: "EMAIL_NOT_VERIFIED",
					message: "Campus email verification is required.",
				}
			: decision.reason === "invalid_email_domain"
				? {
						code: "CAMPUS_EMAIL_REQUIRED",
						message: "A muc.edu.cn email address is required.",
					}
				: decision.reason === "password_change_required"
					? {
							code: "PASSWORD_CHANGE_REQUIRED",
							message: "The password must be changed before continuing.",
						}
					: {
							code: "BANNED_USER",
							message: "This account is banned.",
						};

	throw APIError.from("FORBIDDEN", error);
}

export const CAMPUS_AUTH_USER_ADDITIONAL_FIELDS = {
	passwordChangeRequired: {
		defaultValue: false,
		input: false,
		required: true,
		type: "boolean",
	},
	temporaryPasswordExpiresAt: {
		input: false,
		required: false,
		type: "date",
	},
} as const;
