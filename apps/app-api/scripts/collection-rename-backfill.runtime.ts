import { Client, type ClientConfig } from "pg";

import type { Env } from "../src/config";
import { buildOperatorDatabaseConfig } from "../src/db/runtime";

import type { LocalCollectionRenameBackfillRuntime } from "./collection-rename-backfill.shared";

function readOptionalString(
	env: NodeJS.ProcessEnv,
	key: keyof NodeJS.ProcessEnv,
): string | undefined {
	const value = env[key];
	if (typeof value !== "string") {
		return;
	}
	const trimmed = value.trim();
	return trimmed ? trimmed : undefined;
}

export function buildLocalCollectionRenameBackfillRuntime(
	sourceEnv: NodeJS.ProcessEnv,
): LocalCollectionRenameBackfillRuntime {
	const baseEnv: Env = {
		APP_API_DATABASE_SSLMODE: readOptionalString(sourceEnv, "APP_API_DATABASE_SSLMODE") as
			| Env["APP_API_DATABASE_SSLMODE"]
			| undefined,
		APP_API_ENVIRONMENT: readOptionalString(sourceEnv, "APP_API_ENVIRONMENT") as
			| Env["APP_API_ENVIRONMENT"]
			| undefined,
		APP_API_OPERATOR_DATABASE_URL: readOptionalString(sourceEnv, "APP_API_OPERATOR_DATABASE_URL"),
	};
	const operatorClientConfig = buildOperatorDatabaseConfig(baseEnv);
	const runtimeConnectionString =
		readOptionalString(sourceEnv, "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB") ||
		operatorClientConfig.connectionString;

	return {
		env: {
			...baseEnv,
			APP_API_DB: {
				connectionString: runtimeConnectionString,
			},
		},
		operatorClientConfig,
	};
}

export async function connectOperatorClient(runtime: LocalCollectionRenameBackfillRuntime) {
	const client = new Client(runtime.operatorClientConfig as ClientConfig);
	await client.connect();
	return client;
}
