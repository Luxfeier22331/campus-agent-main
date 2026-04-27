import { DEFAULT_SMOKE_EMAIL, DEFAULT_SMOKE_NAME } from "./seed-request-smoke.args";
import {
	DEFAULT_STAGING_APP_API_READYZ_URL,
	DEFAULT_STAGING_CHAT_BASE_URL,
} from "./staging-chat-smoke.args";

export const DEFAULT_STAGING_DOCS_BASE_URL = "https://campus-docs-staging.ayafeed.com";
export const DEFAULT_STAGING_GATED_READER_PATH =
	"/_gated-docs/curriculum/curriculum_plan/%E4%B8%AD%E5%A4%AE%E6%B0%91%E6%97%8F%E5%A4%A7%E5%AD%A6%E5%A4%A7%E5%AD%A6%E7%94%9F%E7%A4%BE%E4%BC%9A%E5%AE%9E%E8%B7%B5%E7%8E%AF%E8%8A%82%E5%AE%9E%E6%96%BD%E6%96%B9%E6%A1%88/2022-current/reader.json";

export interface StagingDocsGatedSmokeArgs {
	appApiReadyzUrl: string;
	chatBaseUrl: string;
	docsBaseUrl: string;
	email: string;
	gatedReaderPath: string;
	name: string;
	smokeAuthSecret: string;
}

function normalizeOptionalValue(value: string | undefined): string | null {
	if (typeof value !== "string") {
		return null;
	}

	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

function normalizePath(value: string): string {
	return value.startsWith("/") ? value : `/${value}`;
}

export function parseStagingDocsGatedSmokeArgs(
	argv: string[],
	env: NodeJS.ProcessEnv = process.env,
): StagingDocsGatedSmokeArgs {
	let email = DEFAULT_SMOKE_EMAIL;
	let name = DEFAULT_SMOKE_NAME;
	let chatBaseUrl = DEFAULT_STAGING_CHAT_BASE_URL;
	let appApiReadyzUrl = DEFAULT_STAGING_APP_API_READYZ_URL;
	let docsBaseUrl = DEFAULT_STAGING_DOCS_BASE_URL;
	let gatedReaderPath = DEFAULT_STAGING_GATED_READER_PATH;
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
		if (token === "--docs-base-url") {
			const value = normalizeOptionalValue(argv[index + 1]);
			if (!value) {
				throw new Error("--docs-base-url requires a non-empty value.");
			}
			docsBaseUrl = value;
			index += 1;
			continue;
		}
		if (token === "--gated-reader-path") {
			const value = normalizeOptionalValue(argv[index + 1]);
			if (!value) {
				throw new Error("--gated-reader-path requires a non-empty value.");
			}
			gatedReaderPath = normalizePath(value);
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
		docsBaseUrl,
		email,
		gatedReaderPath,
		name,
		smokeAuthSecret,
	};
}
