export const SIGNUP_LEGAL_CONSENT_HEADER_NAME = "x-campus-legal-accepted";
export const SIGNUP_LEGAL_CONSENT_HEADER_VALUE = "terms-and-privacy";
export const SIGNUP_LEGAL_CONSENT_REQUIRED_MESSAGE = "请先阅读并同意用户服务协议和隐私政策。";
export const SIGNUP_LEGAL_CONSENT_FIELD_NAME = "legalConsentAccepted";

export function buildSignupLegalConsentHeaders(headers: HeadersInit | undefined): HeadersInit {
	const nextHeaders = new Headers(headers);
	nextHeaders.set(SIGNUP_LEGAL_CONSENT_HEADER_NAME, SIGNUP_LEGAL_CONSENT_HEADER_VALUE);
	return nextHeaders;
}
