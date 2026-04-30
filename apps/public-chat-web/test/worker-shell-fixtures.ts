import packageManifestRaw from "../package.json?raw";

export const packageManifest = JSON.parse(packageManifestRaw) as {
	scripts?: Record<string, string | undefined>;
};

export const EXPECTED_PUBLIC_CHAT_SECURITY_HEADERS = {
	cspHasBaseUri: true,
	cspHasChallengeFrame: true,
	cspHasDefaultSrc: true,
	cspHasFrameAncestors: true,
	cspHasObjectSrc: true,
	permissionsPolicy: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
	referrerPolicy: "strict-origin-when-cross-origin",
	xContentTypeOptions: "nosniff",
} as const;

export function readPublicChatSecurityHeaders(response: Response) {
	const csp = response.headers.get("content-security-policy");
	return {
		cspHasBaseUri: csp?.includes("base-uri 'self'") ?? false,
		cspHasChallengeFrame: csp?.includes("https://challenges.cloudflare.com") ?? false,
		cspHasDefaultSrc: csp?.includes("default-src 'self'") ?? false,
		cspHasFrameAncestors: csp?.includes("frame-ancestors 'none'") ?? false,
		cspHasObjectSrc: csp?.includes("object-src 'none'") ?? false,
		permissionsPolicy: response.headers.get("permissions-policy"),
		referrerPolicy: response.headers.get("referrer-policy"),
		xContentTypeOptions: response.headers.get("x-content-type-options"),
	};
}
