import { DEFAULT_SMOKE_EMAIL, DEFAULT_SMOKE_NAME } from "./seed-request-smoke.args";

export const DEFAULT_STAGING_CHAT_SMOKE_PROMPT = "中央民族大学本科学生国家奖学金评审办法";
export const DEFAULT_STAGING_CHAT_BASE_URL = "https://campus-chat-staging.ayafeed.com";
export const DEFAULT_STAGING_APP_API_READYZ_URL = "https://campus-api-staging.ayafeed.com/readyz";
export const DEFAULT_STAGING_EXEC_READYZ_URL = "https://exec-staging.ayafeed.com/readyz";

export interface StagingChatSmokeArgs {
	appApiReadyzUrl: string;
	chatBaseUrl: string;
	email: string;
	execReadyzUrl: string;
	name: string;
	prompt: string;
	smokeAuthSecret: string;
}

function normalizeOptionalValue(value: string | undefined): string | null {
	if (typeof value !== "string") {
		return null;
	}

	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

export function parseStagingChatSmokeArgs(
	argv: string[],
	env: NodeJS.ProcessEnv = process.env,
): StagingChatSmokeArgs {
	let email = DEFAULT_SMOKE_EMAIL;
	let name = DEFAULT_SMOKE_NAME;
	let prompt = DEFAULT_STAGING_CHAT_SMOKE_PROMPT;
	let chatBaseUrl = DEFAULT_STAGING_CHAT_BASE_URL;
	let appApiReadyzUrl = DEFAULT_STAGING_APP_API_READYZ_URL;
	let execReadyzUrl = DEFAULT_STAGING_EXEC_READYZ_URL;
	let smokeAuthSecret =
		normalizeOptionalValue(env.APP_API_STAGING_SMOKE_AUTH_SECRET) ??
		normalizeOptionalValue(env.STAGING_APP_API_SMOKE_AUTH_SECRET) ??
		"";

	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];
		if (token === "--") {
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
		if (token === "--name") {
			const value = normalizeOptionalValue(argv[index + 1]);
			if (!value) {
				throw new Error("--name requires a non-empty value.");
			}
			name = value;
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
			index += 1;
			continue;
		}
		if (token === "--app-api-readyz-url") {
			const value = normalizeOptionalValue(argv[index + 1]);
			if (!value) {
				throw new Error("--app-api-readyz-url requires a non-empty value.");
			}
			appApiReadyzUrl = value;
			index += 1;
			continue;
		}
		if (token === "--exec-readyz-url") {
			const value = normalizeOptionalValue(argv[index + 1]);
			if (!value) {
				throw new Error("--exec-readyz-url requires a non-empty value.");
			}
			execReadyzUrl = value;
			index += 1;
			continue;
		}
		if (token === "--smoke-auth-secret") {
			const value = normalizeOptionalValue(argv[index + 1]);
			if (!value) {
				throw new Error("--smoke-auth-secret requires a non-empty value.");
			}
			smokeAuthSecret = value;
			index += 1;
			continue;
		}

		throw new Error(`Unknown argument: ${token}`);
	}
	if (!smokeAuthSecret) {
		throw new Error(
			"APP_API_STAGING_SMOKE_AUTH_SECRET or STAGING_APP_API_SMOKE_AUTH_SECRET is required.",
		);
	}

	return {
		appApiReadyzUrl,
		chatBaseUrl,
		email,
		execReadyzUrl,
		name,
		prompt,
		smokeAuthSecret,
	};
}
