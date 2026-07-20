import { type PostgresConnectionConfig, readPostgresConnectionConfig } from "./postgres-config";

export interface IngestionTemporalWorkerRuntimeConfig {
	database: PostgresConnectionConfig;
	registryRoot: string;
	siteId: string;
}

export function buildIngestionTemporalWorkerRuntimeConfig(
	env: Record<string, string | undefined>,
): IngestionTemporalWorkerRuntimeConfig {
	return {
		database: readPostgresConnectionConfig(env, {
			caCertPath: "INGESTION_CONTROL_DATABASE_CA_CERT_PATH",
			connectionString: "INGESTION_CONTROL_DATABASE_URL",
			sslMode: "INGESTION_CONTROL_DATABASE_SSLMODE",
		}),
		registryRoot: requiredEnv(env, "INGESTION_TASK_REGISTRY_ROOT"),
		siteId: requiredEnv(env, "INTERNAL_PORTAL_SITE_ID"),
	};
}

function requiredEnv(env: Record<string, string | undefined>, key: string): string {
	const value = env[key]?.trim();
	if (!value) {
		throw new Error(`${key} is required`);
	}
	return value;
}
