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
		objectStoreAccessKey: requireEnv(env, "OBJECT_STORE_ACCESS_KEY"),
		objectStoreBucket: requireEnv(env, "DINING_OBJECT_STORE_BUCKET"),
		objectStoreEndpoint: requireEnv(env, "OBJECT_STORE_ENDPOINT"),
		objectStorePublicBaseUrl: requireEnv(env, "DINING_OBJECT_STORE_PUBLIC_BASE_URL"),
		objectStoreRegion: env.OBJECT_STORE_REGION?.trim() || "us-east-1",
		objectStoreReviewPrefix: env.DINING_OBJECT_STORE_REVIEW_PREFIX?.trim() || "dining/reviews",
		objectStoreSecretKey: requireEnv(env, "OBJECT_STORE_SECRET_KEY"),
		postgresUrl: requireEnv(env, "DATABASE_URL"),
	};
}

export function loadCatalogImportConfig(
	env: NodeJS.ProcessEnv = process.env,
): DiningCatalogImportConfig {
	return {
		appEnvironment: env.APP_API_ENVIRONMENT?.trim() || "development",
		postgresUrl: requireEnv(env, "DATABASE_URL"),
	};
}

export function loadMigrationConfig(
	env: NodeJS.ProcessEnv = process.env,
): DiningMigrationConfig {
	return {
		postgresUrl: requireEnv(env, "DINING_MIGRATION_DATABASE_URL"),
	};
}

export function loadLocalMigrationConfig(
	env: NodeJS.ProcessEnv = process.env,
): DiningMigrationConfig {
	return { postgresUrl: requireEnv(env, "DATABASE_URL") };
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
		postgresUrl: requireEnv(env, "DATABASE_URL"),
	};
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
