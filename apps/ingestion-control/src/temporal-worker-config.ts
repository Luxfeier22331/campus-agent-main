import { type PostgresConnectionConfig, readPostgresConnectionConfig } from "./postgres-config";
import { INGESTION_TASK_REGISTRY_ROOT } from "./runtime-paths";

export interface IngestionTemporalWorkerRuntimeConfig {
	database: PostgresConnectionConfig;
	registryRoot: string;
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
		registryRoot: INGESTION_TASK_REGISTRY_ROOT,
	};
}
