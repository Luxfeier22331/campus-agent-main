import {
	DEFAULT_STAGING_CHAT_E2E_APP_API_READYZ_URL,
	DEFAULT_STAGING_CHAT_E2E_CHAT_BASE_URL,
} from "./chat-e2e.args";

export const DEFAULT_STAGING_DOCS_BASE_URL = "https://docs-staging.mucwiki-edge.link";
export const DEFAULT_STAGING_DOCS_GATED_APP_API_READYZ_URL =
	DEFAULT_STAGING_CHAT_E2E_APP_API_READYZ_URL;
export const DEFAULT_STAGING_DOCS_GATED_CHAT_BASE_URL = DEFAULT_STAGING_CHAT_E2E_CHAT_BASE_URL;
export const DEFAULT_GATED_NAVIGATION_UNAUTHENTICATED_STATUS = 404;

export interface StagingDocsGatedSmokeArgs {
	appApiReadyzUrl: string;
	captchaToken: string;
	chatBaseUrl: string;
	docsBaseUrl: string;
	email: string;
	gatedCollectionNavigationPath: string | null;
	gatedCollectionNavigationUnauthenticatedStatus: 200 | 404;
	gatedReaderPath: string | null;
	password: string;
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

export function resolveStagingDocsGatedSmokeTargets(
	args: StagingDocsGatedSmokeArgs,
): StagingDocsGatedSmokeArgs & {
	gatedCollectionNavigationPath: string;
	gatedReaderPath: string;
} {
	if (!(args.gatedCollectionNavigationPath && args.gatedReaderPath)) {
		throw new Error(
			"gated docs smoke requires explicit collection navigation and reader paths from the selected release",
		);
	}
	return {
		...args,
		gatedCollectionNavigationPath: args.gatedCollectionNavigationPath,
		gatedReaderPath: args.gatedReaderPath,
	};
}

export function parseStagingDocsGatedSmokeArgs(argv: string[]): StagingDocsGatedSmokeArgs {
	let captchaToken = "";
	let email = "";
	let chatBaseUrl = DEFAULT_STAGING_DOCS_GATED_CHAT_BASE_URL;
	let appApiReadyzUrl = DEFAULT_STAGING_DOCS_GATED_APP_API_READYZ_URL;
	let docsBaseUrl = DEFAULT_STAGING_DOCS_BASE_URL;
	let gatedCollectionNavigationPath: string | null = null;
	let gatedCollectionNavigationUnauthenticatedStatus: 200 | 404 =
		DEFAULT_GATED_NAVIGATION_UNAUTHENTICATED_STATUS;
	let gatedReaderPath: string | null = null;
	let password = "";

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
		if (token === "--captcha-token") {
			const value = normalizeOptionalValue(argv[index + 1]);
			if (!value) {
				throw new Error("--captcha-token requires a non-empty value.");
			}
			captchaToken = value;
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
		if (token === "--gated-collection-navigation-path") {
			const value = normalizeOptionalValue(argv[index + 1]);
			if (!value) {
				throw new Error("--gated-collection-navigation-path requires a non-empty value.");
			}
			gatedCollectionNavigationPath = normalizePath(value);
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
		if (token === "--gated-collection-navigation-unauthenticated-status") {
			const value = normalizeOptionalValue(argv[index + 1]);
			if (value !== "200" && value !== "404") {
				throw new Error("--gated-collection-navigation-unauthenticated-status must be 200 or 404.");
			}
			gatedCollectionNavigationUnauthenticatedStatus = Number(value) as 200 | 404;
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

		throw new Error(`Unknown argument: ${token}`);
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
		docsBaseUrl,
		email,
		gatedCollectionNavigationPath,
		gatedCollectionNavigationUnauthenticatedStatus,
		gatedReaderPath,
		password,
	};
}
