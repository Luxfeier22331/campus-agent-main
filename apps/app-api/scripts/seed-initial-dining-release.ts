import type { Env } from "../src/config";
import { createRuntimeDatabase } from "../src/db/runtime";
import {
	createDiningFloorplanObjectStoreFromEnv,
	ensureInitialDiningOperationsRelease,
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
		OBJECT_STORE_ACCESS_KEY: env.OBJECT_STORE_ACCESS_KEY,
		OBJECT_STORE_BUCKET_DERIVED: env.OBJECT_STORE_BUCKET_DERIVED,
		OBJECT_STORE_DERIVED_ACCESS_KEY: env.OBJECT_STORE_DERIVED_ACCESS_KEY,
		OBJECT_STORE_DERIVED_SECRET_KEY: env.OBJECT_STORE_DERIVED_SECRET_KEY,
		OBJECT_STORE_ENDPOINT: env.OBJECT_STORE_ENDPOINT,
		OBJECT_STORE_REGION: env.OBJECT_STORE_REGION,
		OBJECT_STORE_SECRET_KEY: env.OBJECT_STORE_SECRET_KEY,
	};
}

async function main() {
	const env = buildRuntimeEnv(process.env);
	const floorplanObjectStore = createDiningFloorplanObjectStoreFromEnv(env);
	if (!floorplanObjectStore) {
		throw new Error("Dining initial release seed requires OBJECT_STORE_* derived bucket config.");
	}
	const seeded = await ensureInitialDiningOperationsRelease({
		db: await createRuntimeDatabase(env, { consistency: "fresh" }),
		floorplanObjectStore,
	});
	console.log(
		JSON.stringify({
			releaseId: "dining_release:initial",
			seeded,
			status: seeded ? "created" : "unchanged",
		}),
	);
}

void main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
