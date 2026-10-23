import { APIError } from "better-auth/api";
import type { EmailAccessService } from "../email-access";

export const SIGNUP_LEGAL_CONSENT_HEADER_NAME = "x-campus-legal-accepted";
export const SIGNUP_LEGAL_CONSENT_HEADER_VALUE = "terms-and-privacy";

const END_USER_EMAIL_PASSWORD_AUTH_PATHS = new Set([
	"/change-email",
	"/sign-in/email",
	"/sign-up/email",
	"/send-verification-email",
	"/request-password-reset",
]);

export function extractAuthRequestEmail(body: unknown): string | null {
	if (!body || typeof body !== "object") {
		return null;
	}

	const email = "newEmail" in body ? body.newEmail : "email" in body ? body.email : null;
	return typeof email === "string" ? email : null;
}

export function extractAuthResetRedirect(body: unknown): string | null {
	if (!body || typeof body !== "object" || !("redirectTo" in body)) {
		return null;
	}

	const redirectTo = body.redirectTo;
	return typeof redirectTo === "string" ? redirectTo : null;
}

export async function enforceEndUserEmailAdmission(
	input: {
		path: string | undefined;
		email: string | null;
	},
	emailAccessService: Pick<EmailAccessService, "assertEmailEnrollment">,
): Promise<void> {
	if (!(input.path && END_USER_EMAIL_PASSWORD_AUTH_PATHS.has(input.path))) {
		return;
	}
	if (!input.email) {
		throw APIError.from("FORBIDDEN", {
			code: "EMAIL_ACCESS_REQUIRED",
			message: "This email is not admitted.",
		});
	}
	await emailAccessService.assertEmailEnrollment(input.email);
}

export function enforceSignupLegalConsent(input: {
	path: string | undefined;
	headers: Headers | undefined;
}): void {
	if (input.path !== "/sign-up/email") {
		return;
	}

	const accepted = input.headers?.get(SIGNUP_LEGAL_CONSENT_HEADER_NAME)?.trim();
	if (accepted === SIGNUP_LEGAL_CONSENT_HEADER_VALUE) {
		return;
	}

	throw APIError.from("BAD_REQUEST", {
		code: "legal_consent_required",
		message: "legal_consent_required",
	});
}

export function enforcePasswordChangeSessionRevocation(input: {
	body: unknown;
	path: string | undefined;
}): Record<string, unknown> | null {
	if (input.path !== "/change-password" || !input.body || typeof input.body !== "object") {
		return null;
	}
	return { ...input.body, revokeOtherSessions: true };
}
