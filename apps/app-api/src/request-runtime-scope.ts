import type { Env } from "./config";
import {
  createRuntimeDatabase,
  createScopedRuntimeDbGetter,
  type RuntimeDatabaseConsistency,
  type RuntimeDatabase,
  type RuntimeDbGetter,
} from "./db/runtime";
import { createAppAuth, type AppAuth } from "./modules/auth";

export interface RequestRuntimeScope {
  getAppAuth(): Promise<AppAuth>;
  getDb(): Promise<RuntimeDatabase>;
  getFreshDb(): Promise<RuntimeDatabase>;
}

export interface RequestRuntimeScopeDependencies {
  createAppAuth?: (input: {
    database: RuntimeDatabase;
    env: Env;
  }) => Promise<AppAuth>;
  createRuntimeDatabase?: (
    env: Env,
    input?: {
      consistency?: RuntimeDatabaseConsistency;
    },
  ) => Promise<RuntimeDatabase>;
}

function createScopedDbGetter(
  env: Env,
  input: RequestRuntimeScopeDependencies,
  consistency: RuntimeDatabaseConsistency,
): RuntimeDbGetter {
  if (!input.createRuntimeDatabase) {
    return createScopedRuntimeDbGetter(env, { consistency });
  }

  let dbPromise: Promise<RuntimeDatabase> | null = null;
  return () => {
    dbPromise ??= input.createRuntimeDatabase!(env, { consistency });
    return dbPromise;
  };
}

export function createRequestRuntimeScope(
  env: Env,
  input: RequestRuntimeScopeDependencies = {},
): RequestRuntimeScope {
  const getDb = createScopedDbGetter(env, input, "cached");
  const getFreshDb = createScopedDbGetter(env, input, "fresh");
  let authPromise: Promise<AppAuth> | null = null;

  return {
    getDb,
    getFreshDb,
    async getAppAuth() {
      authPromise ??= (async () => {
        const database = await getFreshDb();
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
