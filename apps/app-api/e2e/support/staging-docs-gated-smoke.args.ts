import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	DEFAULT_STAGING_CHAT_E2E_APP_API_READYZ_URL,
	DEFAULT_STAGING_CHAT_E2E_CHAT_BASE_URL,
} from "./chat-e2e.args";
import { DEFAULT_SMOKE_EMAIL, DEFAULT_SMOKE_NAME } from "./smoke-identity-defaults";

export const DEFAULT_STAGING_DOCS_BASE_URL = "https://docs-staging.mucwiki-edge.link";
export const DEFAULT_STAGING_DOCS_GATED_APP_API_READYZ_URL =
	DEFAULT_STAGING_CHAT_E2E_APP_API_READYZ_URL;
export const DEFAULT_STAGING_DOCS_GATED_CHAT_BASE_URL = DEFAULT_STAGING_CHAT_E2E_CHAT_BASE_URL;
export const DEFAULT_GATED_NAVIGATION_UNAUTHENTICATED_STATUS = 404;

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../../..");
export const DEFAULT_DOCS_READER_SYNC_MANIFEST_PATH = resolve(
	repoRoot,
	"var/docs-reader-sync-manifest.staging.json",
);

export interface StagingDocsGatedSmokeArgs {
	appApiReadyzUrl: string;
	chatBaseUrl: string;
	docsBaseUrl: string;
	email: string;
	gatedCollectionNavigationPath: string | null;
	gatedCollectionNavigationUnauthenticatedStatus: 200 | 404;
	gatedReaderPath: string | null;
	name: string;
	docsReaderSyncManifestPath: string;
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

interface PublishedReaderSmokeManifestEntry {
	collection: string;
	corpus: string;
	deliveryMode: string;
	targetObjects: Record<string, string>;
}

interface PublishedReaderSmokeManifest {
	entries: PublishedReaderSmokeManifestEntry[];
}

function isStringRecord(value: unknown): value is Record<string, string> {
	return (
		value !== null &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		Object.values(value).every((item) => typeof item === "string")
	);
}

function normalizeManifestEntry(value: unknown): PublishedReaderSmokeManifestEntry {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("docs reader sync manifest entry must be an object");
	}
	const entry = value as Partial<PublishedReaderSmokeManifestEntry>;
	if (!entry.corpus?.trim()) {
		throw new Error("docs reader sync manifest entry requires corpus");
	}
	if (!entry.collection?.trim()) {
		throw new Error("docs reader sync manifest entry requires collection");
	}
	if (!entry.deliveryMode?.trim()) {
		throw new Error("docs reader sync manifest entry requires deliveryMode");
	}
	if (!isStringRecord(entry.targetObjects)) {
		throw new Error("docs reader sync manifest entry requires targetObjects");
	}
	return {
		collection: entry.collection,
		corpus: entry.corpus,
		deliveryMode: entry.deliveryMode,
		targetObjects: entry.targetObjects,
	};
}

function loadDocsReaderSyncManifest(path: string): PublishedReaderSmokeManifest {
	const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<PublishedReaderSmokeManifest>;
	if (!Array.isArray(parsed.entries)) {
		throw new Error("docs reader sync manifest must contain entries[]");
	}
	return {
		entries: parsed.entries.map(normalizeManifestEntry),
	};
}

function buildCollectionNavigationPath(entry: PublishedReaderSmokeManifestEntry): string {
	return `/api/docs/collections/${encodeURIComponent(entry.corpus)}/${encodeURIComponent(entry.collection)}/navigation`;
}

function normalizeReaderTargetPath(entry: PublishedReaderSmokeManifestEntry): string {
	const reader = normalizeOptionalValue(entry.targetObjects.reader);
	if (!reader) {
		throw new Error(
			`gated docs reader sync manifest entry ${entry.corpus}/${entry.collection} is missing targetObjects.reader`,
		);
	}
	return normalizePath(reader);
}

export function resolveStagingDocsGatedSmokeTargets(
	args: StagingDocsGatedSmokeArgs,
): StagingDocsGatedSmokeArgs & {
	gatedCollectionNavigationPath: string;
	gatedReaderPath: string;
} {
	if (args.gatedCollectionNavigationPath && args.gatedReaderPath) {
		return {
			...args,
			gatedCollectionNavigationPath: args.gatedCollectionNavigationPath,
			gatedReaderPath: args.gatedReaderPath,
		};
	}

	const manifest = loadDocsReaderSyncManifest(args.docsReaderSyncManifestPath);
	const gatedEntry = manifest.entries.find((entry) => entry.deliveryMode === "gated_asset");
	if (!gatedEntry) {
		throw new Error("docs reader sync manifest must contain at least one gated_asset entry.");
	}
	const collectionHasPublicEntry = manifest.entries.some(
		(entry) =>
			entry.corpus === gatedEntry.corpus &&
			entry.collection === gatedEntry.collection &&
			entry.deliveryMode === "public_static_asset",
	);

	return {
		...args,
		gatedCollectionNavigationPath:
			args.gatedCollectionNavigationPath ?? buildCollectionNavigationPath(gatedEntry),
		gatedCollectionNavigationUnauthenticatedStatus: collectionHasPublicEntry ? 200 : 404,
		gatedReaderPath: args.gatedReaderPath ?? normalizeReaderTargetPath(gatedEntry),
	};
}

export function parseStagingDocsGatedSmokeArgs(
	argv: string[],
	env: NodeJS.ProcessEnv = process.env,
): StagingDocsGatedSmokeArgs {
	let email = DEFAULT_SMOKE_EMAIL;
	let name = DEFAULT_SMOKE_NAME;
	let chatBaseUrl = DEFAULT_STAGING_DOCS_GATED_CHAT_BASE_URL;
	let appApiReadyzUrl = DEFAULT_STAGING_DOCS_GATED_APP_API_READYZ_URL;
	let docsBaseUrl = DEFAULT_STAGING_DOCS_BASE_URL;
	let gatedCollectionNavigationPath: string | null = null;
	let gatedReaderPath: string | null = null;
	let docsReaderSyncManifestPath =
		normalizeOptionalValue(env.DOCS_READER_SYNC_MANIFEST_PATH) ??
		DEFAULT_DOCS_READER_SYNC_MANIFEST_PATH;
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
		if (token === "--docs-reader-sync-manifest-path") {
			const value = normalizeOptionalValue(argv[index + 1]);
			if (!value) {
				throw new Error("--docs-reader-sync-manifest-path requires a non-empty value.");
			}
			docsReaderSyncManifestPath = value;
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
		gatedCollectionNavigationPath,
		gatedCollectionNavigationUnauthenticatedStatus: DEFAULT_GATED_NAVIGATION_UNAUTHENTICATED_STATUS,
		gatedReaderPath,
		name,
		docsReaderSyncManifestPath,
		smokeAuthSecret,
	};
}
