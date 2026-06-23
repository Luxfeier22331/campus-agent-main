import type { Env } from "../src/config";
import { createRuntimeDatabase } from "../src/db/runtime";
import {
	createInitialDiningOperationsState,
	createPgDiningOperationsStore,
} from "../src/modules/dining-ops";

function readRequiredString(env: NodeJS.ProcessEnv, key: string): string {
	const value = env[key]?.trim();
	if (!value) {
		throw new Error(`${key} is required.`);
	}
	return value;
}

function buildRuntimeEnv(env: NodeJS.ProcessEnv): Env {
	const operatorDatabaseUrl = readRequiredString(env, "APP_API_OPERATOR_DATABASE_URL");
	return {
		APP_API_DATABASE_SSLMODE: env.APP_API_DATABASE_SSLMODE?.trim() as
			| Env["APP_API_DATABASE_SSLMODE"]
			| undefined,
		APP_API_DB: {
			connectionString: operatorDatabaseUrl,
		},
		APP_API_DB_FRESH: {
			connectionString: operatorDatabaseUrl,
		},
		APP_API_ENVIRONMENT: (env.APP_API_ENVIRONMENT?.trim() ||
			"development") as Env["APP_API_ENVIRONMENT"],
	};
}

async function main() {
	if (process.env.APP_API_ENVIRONMENT?.trim() === "production") {
		throw new Error("Refusing to refresh dining seed in production.");
	}
	const env = buildRuntimeEnv(process.env);
	const store = createPgDiningOperationsStore(env, {
		getDb: () => createRuntimeDatabase(env, { consistency: "fresh" }),
	});
	const state = createInitialDiningOperationsState();
	await store.saveState(state);
	console.log(
		JSON.stringify({
			releaseId: state.publishedRelease?.releaseId ?? null,
			status: "refreshed",
		}),
	);
}

void main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
