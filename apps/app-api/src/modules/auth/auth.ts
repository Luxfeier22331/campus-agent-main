import { betterAuth } from "better-auth";

import { readAppApiConfig, readPublicChatOrigin, type Env } from "../../config";

const AUTH_SESSION_EXPIRES_IN = 60 * 60 * 24 * 7;
const AUTH_SESSION_UPDATE_AGE = 60 * 60 * 24;

export interface BetterAuthConfigInput {
  appName: string;
  betterAuthSecret: string;
  publicChatOrigin: string;
  database: object;
}

export function buildBetterAuthConfig(input: BetterAuthConfigInput) {
  const appOrigin = new URL(input.publicChatOrigin).origin;

  return {
    appName: input.appName,
    baseURL: appOrigin,
    basePath: "/api/auth",
    trustedOrigins: [appOrigin],
    secret: input.betterAuthSecret,
    emailAndPassword: {
      autoSignIn: true,
      enabled: true,
      maxPasswordLength: 128,
      minPasswordLength: 10,
    },
    database: input.database,
    session: {
      expiresIn: AUTH_SESSION_EXPIRES_IN,
      storeSessionInDatabase: true,
      updateAge: AUTH_SESSION_UPDATE_AGE,
    },
    advanced: {
      disableCSRFCheck: false,
      disableOriginCheck: false,
      useSecureCookies: appOrigin.startsWith("https://"),
    },
  };
}

export async function createAppAuth(env: Env) {
  const config = readAppApiConfig(env);
  const { createBetterAuthPool } = await import("../../db/runtime");

  return betterAuth(
    buildBetterAuthConfig({
      appName: config.appName,
      betterAuthSecret: config.betterAuthSecret,
      publicChatOrigin: readPublicChatOrigin(env),
      database: await createBetterAuthPool(env),
    }) as never,
  );
}

type AppAuth = Awaited<ReturnType<typeof createAppAuth>>;
const authCacheHost = globalThis as typeof globalThis & {
  __appApiAuthInstanceCache?: Map<string, Promise<AppAuth>>;
};

function getAuthInstanceCache(): Map<string, Promise<AppAuth>> {
  if (!authCacheHost.__appApiAuthInstanceCache) {
    authCacheHost.__appApiAuthInstanceCache = new Map<string, Promise<AppAuth>>();
  }

  return authCacheHost.__appApiAuthInstanceCache;
}

export async function getAppAuth(env: Env): Promise<AppAuth> {
  const config = readAppApiConfig(env);
  const publicChatOrigin = readPublicChatOrigin(env);
  const cacheKey = [
    config.appName,
    config.environment,
    config.databaseConnectionString,
    config.databaseSslMode,
    publicChatOrigin,
    config.betterAuthSecret,
  ].join("|");

  const cache = getAuthInstanceCache();
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const authPromise = createAppAuth(env);
  cache.set(cacheKey, authPromise);

  try {
    return await authPromise;
  } catch (error) {
    cache.delete(cacheKey);
    throw error;
  }
}

export async function handleAuthRequest(request: Request, env: Env): Promise<Response> {
  const auth = await getAppAuth(env);
  return auth.handler(request);
}
