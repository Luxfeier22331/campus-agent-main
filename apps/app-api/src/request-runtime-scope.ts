import type { Env } from "./config";
import { createScopedRuntimeDbGetter, type RuntimeDatabase } from "./db/runtime";
import { type AppAuth, createAppAuth } from "./modules/auth";

export interface RequestRuntimeScope {
	getAppAuth(): Promise<AppAuth>;
	getDb(): Promise<RuntimeDatabase>;
}

export interface RequestRuntimeScopeDependencies {
	createAppAuth?: (input: { database: RuntimeDatabase; env: Env }) => Promise<AppAuth>;
	createRuntimeDatabase?: (env: Env) => Promise<RuntimeDatabase>;
}

function createScopedDbGetter(env: Env, input: RequestRuntimeScopeDependencies) {
	const createRuntimeDatabase = input.createRuntimeDatabase;
	if (!createRuntimeDatabase) {
		return createScopedRuntimeDbGetter(env);
	}

	let dbPromise: Promise<RuntimeDatabase> | null = null;
	return () => {
		dbPromise ??= createRuntimeDatabase(env);
		return dbPromise;
	};
}

export function createRequestRuntimeScope(
	env: Env,
	input: RequestRuntimeScopeDependencies = {},
): RequestRuntimeScope {
	const getDb = createScopedDbGetter(env, input);
	let authPromise: Promise<AppAuth> | null = null;

	return {
		getDb,
		async getAppAuth() {
			authPromise ??= (async () => {
				const database = await getDb();
				if (input.createAppAuth) {
					return input.createAppAuth({
						database,
						env,
					});
				}

				return createAppAuth(env, { database });
			})();

			return authPromise;
		},
	};
}
