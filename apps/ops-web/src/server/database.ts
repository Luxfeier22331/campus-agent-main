import { Pool } from "pg";
import { resolvePostgresTlsConfig } from "./postgres-tls.ts";
import { logOpsError } from "./safe-logging.ts";

const CONNECTION_TIMEOUT_MS = 5_000;
const IDLE_TIMEOUT_MS = 30_000;
const STATEMENT_TIMEOUT_MS = 10_000;

export interface OpsWebDatabaseEnv {
	DEPLOYMENT_ENVIRONMENT?: string;
	NODE_ENV?: string;
	OPS_WEB_DATABASE_CA_CERT_PATH?: string;
	OPS_WEB_DATABASE_SSLMODE?: string;
	OPS_WEB_DATABASE_URL?: string;
}

export function createOpsWebDatabasePool(env: OpsWebDatabaseEnv = process.env): Pool {
	const databaseUrl = env.OPS_WEB_DATABASE_URL?.trim();
	if (!databaseUrl) {
		throw new Error("OPS_WEB_DATABASE_URL is required.");
	}
	const database = resolvePostgresTlsConfig({
		...(env.OPS_WEB_DATABASE_CA_CERT_PATH ? { caCertPath: env.OPS_WEB_DATABASE_CA_CERT_PATH } : {}),
		databaseUrl,
		...(env.DEPLOYMENT_ENVIRONMENT ? { deploymentEnvironment: env.DEPLOYMENT_ENVIRONMENT } : {}),
		...(env.NODE_ENV ? { nodeEnvironment: env.NODE_ENV } : {}),
		...(env.OPS_WEB_DATABASE_SSLMODE ? { sslMode: env.OPS_WEB_DATABASE_SSLMODE } : {}),
	});
	const pool = new Pool({
		connectionString: database.connectionString,
		connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
		idleTimeoutMillis: IDLE_TIMEOUT_MS,
		max: env.NODE_ENV === "test" ? 1 : 4,
		ssl: database.ssl,
		statement_timeout: STATEMENT_TIMEOUT_MS,
	});
	pool.on("error", (error) => logOpsError("ops_web.postgres_pool", error, { source: "database" }));
	return pool;
}
