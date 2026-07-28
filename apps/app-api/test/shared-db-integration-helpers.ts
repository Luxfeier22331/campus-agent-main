// @vitest-environment node

import type { Env } from "../src/config";

const TURNSTILE_TEST_SECRET_KEY = "1x0000000000000000000000000000000AA";

export function buildSharedDbIntegrationEnv(input: {
	runtimeConnectionString: string;
	overrides?: Partial<Env>;
}): Env {
	const baseEnv: Env = {
		APP_API_ENVIRONMENT: "test",
		APP_API_DATABASE_SSLMODE: "disable",
		APP_API_DB: {
			connectionString: input.runtimeConnectionString,
		},
		APP_API_DB_FRESH: {
			connectionString: input.runtimeConnectionString,
		},
		AUTH_SHELL_ORIGIN: "https://campus.muc.wiki",
		AUTH_EMAIL_FROM: "Campus Agent <auth@example.com>",
		AUTH_TURNSTILE_SECRET_KEY: TURNSTILE_TEST_SECRET_KEY,
		APP_API_EXECUTION_SHARED_SECRET: "shared-db-integration-secret",
		BETTER_AUTH_SECRET: "testcontainers-app-api-product-database-secret",
		RESEND_API_KEY: "shared-db-integration-resend-key",
		EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
	};

	return {
		...baseEnv,
		...input.overrides,
	};
}
