import { readFileSync } from "node:fs";
import { Pool, type PoolConfig } from "pg";

export interface NoticeDatabaseConfig {
	connectionString: string;
	ssl: false | { ca: string; rejectUnauthorized: true };
}

const TLS_QUERY_PARAMETERS = ["ssl", "sslcert", "sslkey", "sslmode", "sslrootcert"] as const;

export function createNoticeDatabasePool(
	env: Record<string, string | undefined>,
	options: Pick<PoolConfig, "max"> = {},
): Pool {
	return new Pool({ ...readNoticeDatabaseConfig(env), ...options });
}

export function readNoticeDatabaseConfig(
	env: Record<string, string | undefined>,
): NoticeDatabaseConfig {
	const connectionString = env.NOTICES_DATABASE_URL?.trim() || postgresEnvironmentUrl(env);
	let url: URL;
	try {
		url = new URL(connectionString);
	} catch {
		throw new Error("NOTICES_DATABASE_URL must be a PostgreSQL connection URL");
	}
	if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
		throw new Error("NOTICES_DATABASE_URL must be a PostgreSQL connection URL");
	}
	for (const parameter of TLS_QUERY_PARAMETERS) {
		if (url.searchParams.has(parameter)) {
			throw new Error(
				`NOTICES_DATABASE_URL must not contain PostgreSQL TLS parameter ${parameter}; use NOTICES_DATABASE_SSLMODE and NOTICES_DATABASE_CA_CERT_PATH`,
			);
		}
	}

	const sslMode = env.NOTICES_DATABASE_SSLMODE?.trim() || "verify-full";
	if (sslMode === "disable") {
		const deploymentEnvironment = env.DEPLOYMENT_ENVIRONMENT?.trim();
		if (
			deploymentEnvironment !== "local" &&
			deploymentEnvironment !== "development" &&
			!(deploymentEnvironment === undefined && env.NODE_ENV?.trim() === "test")
		) {
			throw new Error(
				"NOTICES_DATABASE_SSLMODE=disable is only allowed for local, development, or NODE_ENV=test without DEPLOYMENT_ENVIRONMENT",
			);
		}
		return { connectionString, ssl: false };
	}
	if (sslMode !== "verify-full") {
		throw new Error("NOTICES_DATABASE_SSLMODE must be verify-full or disable");
	}
	const caCertPath = required(env, "NOTICES_DATABASE_CA_CERT_PATH");
	const ca = readFileSync(caCertPath, "utf8").trim();
	if (!ca) {
		throw new Error("NOTICES_DATABASE_CA_CERT_PATH must reference a non-empty CA certificate");
	}
	return { connectionString, ssl: { ca, rejectUnauthorized: true } };
}

function postgresEnvironmentUrl(env: Record<string, string | undefined>): string {
	const host = required(env, "PGHOST");
	const port = required(env, "PGPORT");
	if (!/^[1-9][0-9]{0,4}$/u.test(port) || Number(port) > 65_535) {
		throw new Error("PGPORT must be a valid TCP port");
	}
	const database = required(env, "PGDATABASE");
	const url = new URL(`postgresql://${host}:${port}/${encodeURIComponent(database)}`);
	url.username = required(env, "PGUSER");
	url.password = required(env, "PGPASSWORD");
	return url.toString();
}

function required(env: Record<string, string | undefined>, key: string): string {
	const value = env[key]?.trim();
	if (!value) {
		throw new Error(`${key} is required`);
	}
	return value;
}

export {
	isNoticeLockSkipped,
	type NoticeLockSkipped,
	type NoticeProcessingStage,
	recordAutomaticClassificationFailure,
	recordNoticeProcessingFailure,
	withNoticeMaintenanceLock,
	withNoticeProcessingLock,
} from "./processing.ts";
