import { readFileSync } from "node:fs";

import { z } from "zod";

export const DINING_SOURCE_CONFIG_PATH = "/etc/campus-agent/dining/source.json";
export const DINING_MEDIA_BUCKET = "campus-dining-media";
export const DINING_MEDIA_REGION = "us-east-1";

const catalogSchema = z.strictObject({
	campusTableId: z.string().trim().min(1),
	dishTableId: z.string().trim().min(1),
	hallTableId: z.string().trim().min(1),
	stallTableId: z.string().trim().min(1),
});

const reviewSchema = z.strictObject({
	tableId: z.string().trim().min(1),
	viewId: z.string().trim().min(1),
});

export const DiningSourceConfigSchema = z.strictObject({
	appId: z.string().trim().min(1),
	baseToken: z.string().trim().min(1),
	catalog: catalogSchema,
	provider: z.literal("lark"),
	review: reviewSchema,
	version: z.literal(1),
});

export type DiningSourceConfig = z.infer<typeof DiningSourceConfigSchema>;

export interface DiningCatalogSyncConfig {
	lark: Pick<DiningSourceConfig, "appId" | "baseToken" | "catalog"> & { appSecret: string };
	postgresUrl: string;
}

export interface DiningReviewSyncConfig {
	lark: Pick<DiningSourceConfig, "appId" | "baseToken" | "review"> & { appSecret: string };
	moderationApiKey: string;
	objectStore: {
		accessKey: string;
		endpoint: string;
		publicEndpoint: string;
		secretKey: string;
	};
	postgresUrl: string;
}

export interface DiningReviewRecheckConfig {
	moderationApiKey: string;
	postgresUrl: string;
}

export interface DiningDatabaseInstallConfig {
	postgresUrl: string;
}

export function loadCatalogSyncConfig(
	env: NodeJS.ProcessEnv = process.env,
	source = loadDiningSourceConfig(env),
): DiningCatalogSyncConfig {
	return {
		lark: {
			appId: source.appId,
			appSecret: requireEnv(env, "DINING_LARK_APP_SECRET"),
			baseToken: source.baseToken,
			catalog: source.catalog,
		},
		postgresUrl: postgresUrlFromEnv(env),
	};
}

export function loadReviewSyncConfig(
	env: NodeJS.ProcessEnv = process.env,
	source = loadDiningSourceConfig(env),
): DiningReviewSyncConfig {
	return {
		lark: {
			appId: source.appId,
			appSecret: requireEnv(env, "DINING_LARK_APP_SECRET"),
			baseToken: source.baseToken,
			review: source.review,
		},
		moderationApiKey: requireEnv(env, "DINING_MODERATION_API_KEY"),
		objectStore: {
			accessKey: requireEnv(env, "OBJECT_STORE_DERIVED_ACCESS_KEY"),
			endpoint: parseEndpoint(requireEnv(env, "OBJECT_STORE_ENDPOINT"), "OBJECT_STORE_ENDPOINT"),
			publicEndpoint: parseEndpoint(
				requireEnv(env, "OBJECT_STORE_PUBLIC_ENDPOINT"),
				"OBJECT_STORE_PUBLIC_ENDPOINT",
			),
			secretKey: requireEnv(env, "OBJECT_STORE_DERIVED_SECRET_KEY"),
		},
		postgresUrl: postgresUrlFromEnv(env),
	};
}

export function loadReviewRecheckConfig(
	env: NodeJS.ProcessEnv = process.env,
): DiningReviewRecheckConfig {
	return {
		moderationApiKey: requireEnv(env, "DINING_MODERATION_API_KEY"),
		postgresUrl: postgresUrlFromEnv(env),
	};
}

export function loadDatabaseInstallConfig(
	env: NodeJS.ProcessEnv = process.env,
): DiningDatabaseInstallConfig {
	return { postgresUrl: postgresUrlFromEnv(env) };
}

export function loadDiningSourceConfig(env: NodeJS.ProcessEnv = process.env): DiningSourceConfig {
	const path = env.DINING_SOURCE_CONFIG_PATH?.trim() || DINING_SOURCE_CONFIG_PATH;
	let value: unknown;
	try {
		value = JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		throw new Error(`Dining source config could not be read from ${path}.`, { cause: error });
	}
	const result = DiningSourceConfigSchema.safeParse(value);
	if (!result.success) {
		throw new Error(`Dining source config at ${path} is invalid: ${z.prettifyError(result.error)}`);
	}
	return result.data;
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

function parseEndpoint(raw: string, key: string): string {
	let url: URL;
	try {
		url = new URL(raw);
	} catch (error) {
		throw new Error(`${key} must be an absolute HTTP(S) URL.`, { cause: error });
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error(`${key} must be an absolute HTTP(S) URL.`);
	}
	return url.toString().replace(/\/$/, "");
}

function requireEnv(env: NodeJS.ProcessEnv, key: string): string {
	const value = env[key]?.trim();
	if (!value) {
		throw new Error(`${key} is required for dining sync.`);
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
