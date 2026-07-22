export interface DiningSyncConfig {
	moderationApiKey: string;
	moderationBaseUrl: string;
	moderationImageModel: string;
	moderationTextModel: string;
	moderationTimeoutMs: number;
	larkAppId: string;
	larkAppSecret: string;
	larkBaseToken: string;
	larkCampusTableId: string;
	larkDishTableId: string;
	larkHallTableId: string;
	larkReviewTableId: string;
	larkReviewViewId: string;
	larkStallTableId: string;
	objectStoreAccessKey: string;
	objectStoreBucket: string;
	objectStoreEndpoint: string;
	objectStorePublicBaseUrl: string;
	objectStoreRegion: string;
	objectStoreReviewPrefix: string;
	objectStoreSecretKey: string;
	postgresUrl: string;
}

export interface DiningCatalogImportConfig {
	appEnvironment: string;
	postgresUrl: string;
}

export interface DiningMigrationConfig {
	postgresUrl: string;
}

export interface DiningCatalogSyncConfig {
	larkAppId: string;
	larkAppSecret: string;
	larkBaseToken: string;
	larkCampusTableId: string;
	larkDishTableId: string;
	larkHallTableId: string;
	larkStallTableId: string;
	postgresUrl: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): DiningSyncConfig {
	return {
		moderationApiKey: requireEnv(env, "DINING_MODERATION_API_KEY"),
		moderationBaseUrl: requireEnv(env, "DINING_MODERATION_BASE_URL"),
		moderationImageModel: env.DINING_MODERATION_IMAGE_MODEL?.trim() || "nsfw-classifier",
		moderationTextModel:
			env.DINING_MODERATION_TEXT_MODEL?.trim() || "Security-semantic-filtering",
		moderationTimeoutMs: parsePositiveIntegerEnv(env, "DINING_MODERATION_TIMEOUT_MS", 10_000),
		larkAppId: requireEnv(env, "DINING_LARK_APP_ID"),
		larkAppSecret: requireEnv(env, "DINING_LARK_APP_SECRET"),
		larkBaseToken: requireEnv(env, "DINING_LARK_BASE_TOKEN"),
		larkCampusTableId: requireEnv(env, "DINING_LARK_CAMPUS_TABLE_ID"),
		larkDishTableId: requireEnv(env, "DINING_LARK_DISH_TABLE_ID"),
		larkHallTableId: requireEnv(env, "DINING_LARK_HALL_TABLE_ID"),
		larkReviewTableId: requireEnv(env, "DINING_LARK_REVIEW_TABLE_ID"),
		larkReviewViewId: requireEnv(env, "DINING_LARK_REVIEW_VIEW_ID"),
		larkStallTableId: requireEnv(env, "DINING_LARK_STALL_TABLE_ID"),
		objectStoreAccessKey: requireEnv(env, "OBJECT_STORE_DERIVED_ACCESS_KEY"),
		objectStoreBucket: requireEnv(env, "DINING_OBJECT_STORE_BUCKET"),
		objectStoreEndpoint: requireEnv(env, "OBJECT_STORE_ENDPOINT"),
		objectStorePublicBaseUrl: requireEnv(env, "DINING_OBJECT_STORE_PUBLIC_BASE_URL"),
		objectStoreRegion: env.OBJECT_STORE_REGION?.trim() || "us-east-1",
		objectStoreReviewPrefix: env.DINING_OBJECT_STORE_REVIEW_PREFIX?.trim() || "dining/reviews",
		objectStoreSecretKey: requireEnv(env, "OBJECT_STORE_DERIVED_SECRET_KEY"),
		postgresUrl: postgresUrlFromEnv(env),
	};
}

export function loadCatalogImportConfig(
	env: NodeJS.ProcessEnv = process.env,
): DiningCatalogImportConfig {
	return {
		appEnvironment: env.APP_API_ENVIRONMENT?.trim() || "development",
		postgresUrl: postgresUrlFromEnv(env),
	};
}

export function loadMigrationConfig(
	env: NodeJS.ProcessEnv = process.env,
): DiningMigrationConfig {
	return {
		postgresUrl: postgresUrlFromEnv(env),
	};
}

export function loadCatalogSyncConfig(
	env: NodeJS.ProcessEnv = process.env,
): DiningCatalogSyncConfig {
	return {
		larkAppId: requireEnv(env, "DINING_LARK_APP_ID"),
		larkAppSecret: requireEnv(env, "DINING_LARK_APP_SECRET"),
		larkBaseToken: requireEnv(env, "DINING_LARK_BASE_TOKEN"),
		larkCampusTableId: requireEnv(env, "DINING_LARK_CAMPUS_TABLE_ID"),
		larkDishTableId: requireEnv(env, "DINING_LARK_DISH_TABLE_ID"),
		larkHallTableId: requireEnv(env, "DINING_LARK_HALL_TABLE_ID"),
		larkStallTableId: requireEnv(env, "DINING_LARK_STALL_TABLE_ID"),
		postgresUrl: postgresUrlFromEnv(env),
	};
}

export function postgresUrlFromEnv(env: NodeJS.ProcessEnv = process.env): string {
	const host = requireEnv(env, "PGHOST");
	const port = parsePort(requireEnv(env, "PGPORT"));
	const database = requireEnv(env, "PGDATABASE");
	const user = requireEnv(env, "PGUSER");
	const password = requireEnv(env, "PGPASSWORD");
	const sslMode = requireEnv(env, "PGSSLMODE");
	if (sslMode !== "disable" && sslMode !== "verify-full") {
		throw new Error("PGSSLMODE must be disable or verify-full for dining sync.");
	}

	const url = new URL("postgresql://localhost");
	url.hostname = host;
	url.port = String(port);
	url.pathname = `/${database}`;
	url.username = user;
	url.password = password;
	url.searchParams.set("sslmode", sslMode);
	if (sslMode === "verify-full") {
		url.searchParams.set("sslrootcert", requireEnv(env, "PGSSLROOTCERT"));
	}
	return url.toString();
}

function requireEnv(env: NodeJS.ProcessEnv, key: string): string {
	const value = env[key]?.trim();
	if (!value) {
		throw new Error(`${key} is required for dining sync.`);
	}
	return value;
}

function parsePositiveIntegerEnv(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
	const rawValue = env[key]?.trim();
	if (!rawValue) {
		return fallback;
	}
	const value = Number.parseInt(rawValue, 10);
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new Error(`${key} must be a positive integer.`);
	}
	return value;
}

function parsePort(rawValue: string): number {
	const port = Number.parseInt(rawValue, 10);
	if (!Number.isSafeInteger(port) || port < 1 || port > 65_535 || String(port) !== rawValue) {
		throw new Error("PGPORT must be an integer between 1 and 65535 for dining sync.");
	}
	return port;
}
