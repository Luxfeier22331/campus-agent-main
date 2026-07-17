import { readFileSync } from "node:fs";

const POSTGRES_PREFIX = /^(postgres|postgresql):\/\//i;
const TLS_QUERY_PARAMETERS = new Set(["ssl", "sslcert", "sslkey", "sslmode", "sslrootcert"]);

export type DatabaseSslConfig = false | { ca: string; rejectUnauthorized: true };

export function readDatabaseConnectionConfig(
	env: NodeJS.ProcessEnv,
	keys: { caCertPath: string; databaseUrl: string; sslMode: string },
): { connectionString: string; ssl: DatabaseSslConfig } {
	const databaseUrl = env[keys.databaseUrl]?.trim();
	if (!databaseUrl) {
		throw new Error(`${keys.databaseUrl} is required for ops-web database verification.`);
	}
	if (!POSTGRES_PREFIX.test(databaseUrl)) {
		throw new Error(`${keys.databaseUrl} must be a PostgreSQL connection string.`);
	}
	assertNoTlsQueryParameters(databaseUrl, keys.databaseUrl);

	const sslMode = env[keys.sslMode]?.trim().toLowerCase() || "verify-full";
	if (sslMode === "disable") {
		if (!isLocalOrTestEnvironment(env)) {
			throw new Error("PostgreSQL TLS may only be disabled for local development or tests.");
		}
		return { connectionString: databaseUrl, ssl: false };
	}
	if (sslMode !== "verify-full") {
		throw new Error(`${keys.sslMode} must be verify-full or disable.`);
	}

	const caCertPath = env[keys.caCertPath]?.trim();
	if (!caCertPath) {
		throw new Error(`${keys.caCertPath} is required when PostgreSQL TLS verification is enabled.`);
	}
	const ca = readFileSync(caCertPath, "utf8");
	if (!ca.trim()) {
		throw new Error(`${keys.caCertPath} must contain a PostgreSQL CA certificate.`);
	}
	return {
		connectionString: databaseUrl,
		ssl: { ca, rejectUnauthorized: true },
	};
}

function assertNoTlsQueryParameters(databaseUrl: string, databaseUrlKey: string): void {
	const parsed = new URL(databaseUrl);
	for (const key of parsed.searchParams.keys()) {
		if (TLS_QUERY_PARAMETERS.has(key.toLowerCase())) {
			throw new Error(`${databaseUrlKey} must not include PostgreSQL TLS query parameters.`);
		}
	}
}

function isLocalOrTestEnvironment(env: NodeJS.ProcessEnv): boolean {
	const deploymentEnvironment = env.DEPLOYMENT_ENVIRONMENT?.trim().toLowerCase();
	const nodeEnvironment = env.NODE_ENV?.trim().toLowerCase();
	if (deploymentEnvironment) {
		return deploymentEnvironment === "development" || deploymentEnvironment === "local";
	}
	return nodeEnvironment === "test";
}
