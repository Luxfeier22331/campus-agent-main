import {
	type ChatE2eExpectedResultKind,
	parseChatE2eExpectedResultKind,
} from "./chat-e2e.result-kind";
export const CHAT_E2E_PROFILES = ["dev", "local-provider", "staging"] as const;
export type ChatE2eProfile = (typeof CHAT_E2E_PROFILES)[number];
export const CHAT_E2E_TRANSPORTS = ["stream", "sync"] as const;
export type ChatE2eTransport = (typeof CHAT_E2E_TRANSPORTS)[number];

export const DEFAULT_CHAT_E2E_PROMPT = "示例大学本科学生国家奖学金评审办法";
export const DEFAULT_STAGING_CHAT_E2E_CHAT_BASE_URL = "https://campus-staging.mucwiki-edge.link";
export const DEFAULT_STAGING_CHAT_E2E_APP_API_READYZ_URL =
	"https://api-staging.mucwiki-edge.link/readyz";
export const DEFAULT_STAGING_CHAT_E2E_EXEC_READYZ_URL: string | null = null;
export const DEFAULT_LOCAL_CHAT_E2E_CHAT_BASE_URL = "http://127.0.0.1:27014";
export const DEFAULT_LOCAL_CHAT_E2E_APP_API_READYZ_URL = "http://127.0.0.1:27031/readyz";
export const DEFAULT_LOCAL_CHAT_E2E_EXEC_READYZ_URL = "http://127.0.0.1:27051/readyz";
export const DEFAULT_CHAT_E2E_CHAT_BASE_URL = DEFAULT_STAGING_CHAT_E2E_CHAT_BASE_URL;
export const DEFAULT_CHAT_E2E_APP_API_READYZ_URL = DEFAULT_STAGING_CHAT_E2E_APP_API_READYZ_URL;
export const DEFAULT_CHAT_E2E_EXEC_READYZ_URL = DEFAULT_STAGING_CHAT_E2E_EXEC_READYZ_URL;
export interface ChatE2eArgs {
	appApiReadyzUrl: string | null;
	captchaToken: string;
	chatBaseUrl: string;
	email: string;
	execReadyzUrl: string | null;
	expectModelExecutionState: string | null;
	expectResultKind: ChatE2eExpectedResultKind;
	password: string;
	profile: ChatE2eProfile;
	prompt: string;
	transport: ChatE2eTransport;
}

function normalizeOptionalValue(value: string | undefined): string | null {
	if (typeof value !== "string") {
		return null;
	}

	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

function parseChatE2eProfile(value: string): ChatE2eProfile {
	if ((CHAT_E2E_PROFILES as readonly string[]).includes(value)) {
		return value as ChatE2eProfile;
	}

	throw new Error(`--profile must be one of: ${CHAT_E2E_PROFILES.join(", ")}.`);
}

function parseChatE2eTransport(value: string): ChatE2eTransport {
	if ((CHAT_E2E_TRANSPORTS as readonly string[]).includes(value)) {
		return value as ChatE2eTransport;
	}

	throw new Error(`--transport must be one of: ${CHAT_E2E_TRANSPORTS.join(", ")}.`);
}

export function parseChatE2eArgs(argv: string[]): ChatE2eArgs {
	let email = "";
	let prompt = DEFAULT_CHAT_E2E_PROMPT;
	let chatBaseUrl = DEFAULT_CHAT_E2E_CHAT_BASE_URL;
	let appApiReadyzUrl: string | null = DEFAULT_CHAT_E2E_APP_API_READYZ_URL;
	let execReadyzUrl: string | null = DEFAULT_CHAT_E2E_EXEC_READYZ_URL;
	let expectModelExecutionState: string | null = null;
	let expectResultKind: ChatE2eExpectedResultKind = "answer";
	let profile: ChatE2eProfile = "staging";
	let transport: ChatE2eTransport = "stream";
	let password = "";
	let captchaToken = "";
	let explicitChatBaseUrl = false;
	let explicitAppApiReadyzUrl = false;
	let explicitExecReadyzUrl = false;

	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];
		if (token === "--") {
			continue;
		}
		if (token === "--profile") {
			const value = normalizeOptionalValue(argv[index + 1]);
			if (!value) {
				throw new Error("--profile requires a non-empty value.");
			}
			profile = parseChatE2eProfile(value);
			index += 1;
			continue;
		}
		if (token === "--email") {
			const value = normalizeOptionalValue(argv[index + 1]);
			if (!value) {
				throw new Error("--email requires a non-empty value.");
			}
			email = value.toLowerCase();
			index += 1;
			continue;
		}
		if (token === "--prompt") {
			const value = normalizeOptionalValue(argv[index + 1]);
			if (!value) {
				throw new Error("--prompt requires a non-empty value.");
			}
			prompt = value;
			index += 1;
			continue;
		}
		if (token === "--chat-base-url") {
			const value = normalizeOptionalValue(argv[index + 1]);
			if (!value) {
				throw new Error("--chat-base-url requires a non-empty value.");
			}
			chatBaseUrl = value;
			explicitChatBaseUrl = true;
			index += 1;
			continue;
		}
		if (token === "--app-api-readyz-url") {
			const value = normalizeOptionalValue(argv[index + 1]);
			if (!value) {
				throw new Error("--app-api-readyz-url requires a non-empty value.");
			}
			appApiReadyzUrl = value;
			explicitAppApiReadyzUrl = true;
			index += 1;
			continue;
		}
		if (token === "--exec-readyz-url") {
			const value = normalizeOptionalValue(argv[index + 1]);
			if (!value) {
				throw new Error("--exec-readyz-url requires a non-empty value.");
			}
			execReadyzUrl = value;
			explicitExecReadyzUrl = true;
			index += 1;
			continue;
		}
		if (token === "--expect-result-kind") {
			const value = normalizeOptionalValue(argv[index + 1]);
			if (!value) {
				throw new Error("--expect-result-kind requires a non-empty value.");
			}
			expectResultKind = parseChatE2eExpectedResultKind(value);
			index += 1;
			continue;
		}
		if (token === "--expect-model-execution-state") {
			const value = normalizeOptionalValue(argv[index + 1]);
			if (!value) {
				throw new Error("--expect-model-execution-state requires a non-empty value.");
			}
			expectModelExecutionState = value;
			index += 1;
			continue;
		}
		if (token === "--transport") {
			const value = normalizeOptionalValue(argv[index + 1]);
			if (!value) {
				throw new Error("--transport requires a non-empty value.");
			}
			transport = parseChatE2eTransport(value);
			index += 1;
			continue;
		}
		if (token === "--password") {
			const value = normalizeOptionalValue(argv[index + 1]);
			if (!value) {
				throw new Error("--password requires a non-empty value.");
			}
			password = value;
			index += 1;
			continue;
		}
		if (token === "--captcha-token") {
			const value = normalizeOptionalValue(argv[index + 1]);
			if (!value) {
				throw new Error("--captcha-token requires a non-empty value.");
			}
			captchaToken = value;
			index += 1;
			continue;
		}

		throw new Error(`Unknown argument: ${token}`);
	}

	if (profile === "dev") {
		if (!explicitChatBaseUrl) {
			chatBaseUrl = DEFAULT_LOCAL_CHAT_E2E_CHAT_BASE_URL;
		}
		if (!explicitAppApiReadyzUrl) {
			appApiReadyzUrl = null;
		}
		if (!explicitExecReadyzUrl) {
			execReadyzUrl = DEFAULT_LOCAL_CHAT_E2E_EXEC_READYZ_URL;
		}
	}
	if (profile === "local-provider") {
		if (!explicitChatBaseUrl) {
			chatBaseUrl = DEFAULT_LOCAL_CHAT_E2E_CHAT_BASE_URL;
		}
		if (!explicitAppApiReadyzUrl) {
			appApiReadyzUrl = DEFAULT_LOCAL_CHAT_E2E_APP_API_READYZ_URL;
		}
		if (!explicitExecReadyzUrl) {
			execReadyzUrl = DEFAULT_LOCAL_CHAT_E2E_EXEC_READYZ_URL;
		}
	}
	if (!email) {
		throw new Error("--email is required.");
	}
	if (!password) {
		throw new Error("--password is required.");
	}
	if (!captchaToken) {
		throw new Error("--captcha-token is required.");
	}

	return {
		appApiReadyzUrl,
		captchaToken,
		chatBaseUrl,
		email,
		execReadyzUrl,
		expectModelExecutionState,
		expectResultKind,
		password,
		profile,
		prompt,
		transport,
	};
}
