const OBJECT_STORE_ENV_KEYS = [
	"OBJECT_STORE_BUCKET_DERIVED",
	"OBJECT_STORE_DERIVED_ACCESS_KEY",
	"OBJECT_STORE_DERIVED_SECRET_KEY",
	"OBJECT_STORE_ENDPOINT",
] as const;

export function omitObjectStoreEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const sanitized = { ...env };
	for (const key of OBJECT_STORE_ENV_KEYS) {
		delete sanitized[key];
	}
	return sanitized;
}
