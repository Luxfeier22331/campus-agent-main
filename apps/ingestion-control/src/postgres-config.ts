import { readFileSync } from "node:fs";

export interface PostgresConnectionConfig {
	connectionString: string;
	ssl: false | { ca: string; rejectUnauthorized: true };
}

export interface PostgresConnectionEnvironmentKeys {
	caCertPath: string;
	connectionString: string;
	sslMode: string;
}

const URL_TLS_PARAMETERS = ["ssl", "sslcert", "sslkey", "sslmode", "sslrootcert"] as const;

export function readPostgresConnectionConfig(
	env: Record<string, string | undefined>,
	keys: PostgresConnectionEnvironmentKeys,
): PostgresConnectionConfig {
	const connectionString = requiredEnv(env, keys.connectionString);
	const url = parsePostgresUrl(connectionString, keys.connectionString);
	for (const parameter of URL_TLS_PARAMETERS) {
		if (url.searchParams.has(parameter)) {
			throw new Error(
				`${keys.connectionString} must not contain PostgreSQL TLS parameter ${parameter}; use ${keys.sslMode} and ${keys.caCertPath}`,
			);
		}
	}

	const sslMode = env[keys.sslMode]?.trim() || "verify-full";
	if (sslMode === "disable") {
		assertTlsDisableAllowed(env, keys.sslMode);
		return { connectionString, ssl: false };
	}
	if (sslMode !== "verify-full") {
		throw new Error(`${keys.sslMode} must be verify-full or disable`);
	}

	const caCertPath = requiredEnv(env, keys.caCertPath);
	const ca = readFileSync(caCertPath, "utf8").trim();
	if (!ca) {
		throw new Error(`${keys.caCertPath} must reference a non-empty CA certificate`);
	}
	return {
		connectionString,
		ssl: { ca, rejectUnauthorized: true },
	};
}

function parsePostgresUrl(value: string, key: string): URL {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error(`${key} must be a PostgreSQL connection URL`);
	}
	if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
		throw new Error(`${key} must be a PostgreSQL connection URL`);
	}
	return url;
}

function assertTlsDisableAllowed(
	env: Record<string, string | undefined>,
	sslModeKey: string,
): void {
	const deploymentEnvironment = env.DEPLOYMENT_ENVIRONMENT?.trim();
	if (deploymentEnvironment === "local" || deploymentEnvironment === "development") {
		return;
	}
	if (!deploymentEnvironment && env.NODE_ENV?.trim() === "test") {
		return;
	}
	throw new Error(
		`${sslModeKey}=disable is only allowed for local, development, or NODE_ENV=test without DEPLOYMENT_ENVIRONMENT`,
	);
}

function requiredEnv(env: Record<string, string | undefined>, key: string): string {
	const value = env[key]?.trim();
	if (!value) {
		throw new Error(`${key} is required`);
	}
	return value;
}
