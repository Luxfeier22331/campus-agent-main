const SENSITIVE_HEADER_LINE_PATTERNS = [
	/^(\s*-\s*cookie:\s*).+$/gim,
	/^(\s*-\s*authorization:\s*Bearer\s+).+$/gim,
	/^(\s*cookie:\s*).+$/gim,
	/^(\s*authorization:\s*Bearer\s+).+$/gim,
];

const SENSITIVE_COOKIE_NAMES = ["SSO_TGC", "JSESSIONID", "nginx"];

export function formatSafeErrorMessage(error: unknown): string {
	let message = error instanceof Error ? error.message : String(error);

	for (const pattern of SENSITIVE_HEADER_LINE_PATTERNS) {
		message = message.replace(pattern, (_match, prefix: string) => {
			if (prefix.toLowerCase().includes("authorization")) {
				return `${prefix}<redacted>`;
			}
			return `${prefix}<redacted>`;
		});
	}

	for (const name of SENSITIVE_COOKIE_NAMES) {
		message = message.replace(new RegExp(`${name}=([^;\\s]+)`, "g"), `${name}=<redacted>`);
	}

	message = message.replace(/Bearer\s+[^;\s]+/gi, "Bearer <redacted>");
	message = message.replace(/([?&]ticket=)[^&#\s]+/gi, "$1<redacted>");

	return message;
}
