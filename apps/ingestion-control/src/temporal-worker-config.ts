export interface IngestionTemporalWorkerRuntimeConfig {
	databaseUrl: string;
	registryRoot: string;
	siteId: string;
}

export function buildIngestionTemporalWorkerRuntimeConfig(
	env: Record<string, string | undefined>,
): IngestionTemporalWorkerRuntimeConfig {
	return {
		databaseUrl: requiredEnv(env, "INGESTION_CONTROL_DATABASE_URL"),
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
