import { validateSsoTgc } from "@campus-agent/internal-portal-client";
import { parseCookie } from "cookie";

const SSO_TGC_COOKIE_NAME = "sso_tgc";

export class InternalPortalCandidateInputError extends Error {
	constructor(options?: ErrorOptions) {
		super("SSO_TGC 或 Cookie 格式无效。", options);
		this.name = "InternalPortalCandidateInputError";
	}
}

export function normalizeInternalPortalCandidateInput(input: string): string {
	const isCookieInput = input.includes(";") || /^\s*sso_tgc\s*=/iu.test(input);
	if (!isCookieInput) {
		return validateCandidateValue(input);
	}
	if (/[\r\n,]/u.test(input)) {
		throw new InternalPortalCandidateInputError();
	}

	let cookies: Record<string, string | undefined>;
	try {
		cookies = parseCookie(input, { decode: (value) => value });
	} catch (error) {
		throw new InternalPortalCandidateInputError({ cause: error });
	}

	const targetSegments = input.split(";").filter((segment) => {
		const separator = segment.indexOf("=");
		return (
			separator >= 0 && segment.slice(0, separator).trim().toLowerCase() === SSO_TGC_COOKIE_NAME
		);
	});
	const targetEntries = Object.entries(cookies).filter(
		([name]) => name.toLowerCase() === SSO_TGC_COOKIE_NAME,
	);
	if (targetSegments.length !== 1 || targetEntries.length !== 1) {
		throw new InternalPortalCandidateInputError();
	}

	return validateCandidateValue(targetEntries[0]?.[1] ?? "");
}

function validateCandidateValue(value: string): string {
	try {
		return validateSsoTgc(value);
	} catch (error) {
		throw new InternalPortalCandidateInputError({ cause: error });
	}
}
