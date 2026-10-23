export const CAMPUS_EMAIL_DOMAIN = "muc.edu.cn";

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
