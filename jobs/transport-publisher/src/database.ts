import { readFileSync } from "node:fs";
import type { ClientConfig } from "pg";

const TLS_QUERY_PARAMETERS = new Set(["ssl", "sslcert", "sslkey", "sslmode", "sslrootcert"]);

function readRequiredEnv(env: NodeJS.ProcessEnv, key: string): string {
	const value = env[key]?.trim();
	if (!value) {
		throw new Error(`${key} is required`);
	}
	return value;
}

function withoutTlsQueryParameters(databaseUrl: string): string {
	const url = new URL(databaseUrl);
	for (const key of TLS_QUERY_PARAMETERS) {
		url.searchParams.delete(key);
	}
	return url.toString();
}

export function readTransportPublisherDatabaseConfig(
	env: NodeJS.ProcessEnv = process.env,
): ClientConfig {
	const connectionString = withoutTlsQueryParameters(readRequiredEnv(env, "DATABASE_URL"));
	const sslMode = env.DATABASE_SSLMODE?.trim() || "verify-full";
	if (sslMode === "disable") {
		return { connectionString, ssl: false };
	}
	if (sslMode !== "verify-full") {
		throw new Error("DATABASE_SSLMODE must be verify-full or disable");
	}
	const caCertPath = readRequiredEnv(env, "DATABASE_CA_CERT_PATH");
	const ca = readFileSync(caCertPath, "utf8");
	if (!ca.includes("BEGIN CERTIFICATE")) {
		throw new Error("DATABASE_CA_CERT_PATH must contain a PostgreSQL CA certificate");
	}
	return {
		connectionString,
		ssl: { ca, rejectUnauthorized: true },
	};
}
