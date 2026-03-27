import { betterAuth } from "better-auth";
import { tanstackStartCookies } from "better-auth/tanstack-start";

import { createBetterAuthPool } from "./db.server";
import type { PublicChatServerEnv } from "./env.server";

const AUTH_SESSION_EXPIRES_IN = 60 * 60 * 24 * 7;
const AUTH_SESSION_UPDATE_AGE = 60 * 60 * 24;
const AUTH_RATE_LIMIT_WINDOW = 60;
const AUTH_RATE_LIMIT_MAX = 10;

export function buildBetterAuthConfig(env: PublicChatServerEnv) {
  const appOrigin = new URL(env.appBaseUrl).origin;

  return {
    appName: "Campus Agent",
    baseURL: env.appBaseUrl,
    basePath: "/api/auth",
    trustedOrigins: [appOrigin],
    secret: env.betterAuthSecret,
    emailAndPassword: {
      autoSignIn: true,
      enabled: true,
      maxPasswordLength: 128,
      minPasswordLength: 10,
    },
    plugins: [tanstackStartCookies()],
    database: createBetterAuthPool(env),
    session: {
      expiresIn: AUTH_SESSION_EXPIRES_IN,
      storeSessionInDatabase: true,
      updateAge: AUTH_SESSION_UPDATE_AGE,
    },
    rateLimit: {
      enabled: env.nodeEnv === "production",
      max: AUTH_RATE_LIMIT_MAX,
      storage: "memory",
      window: AUTH_RATE_LIMIT_WINDOW,
    },
    advanced: {
      disableCSRFCheck: false,
      disableOriginCheck: false,
      useSecureCookies: env.appBaseUrl.startsWith("https://"),
    },
  };
}

export function createPublicChatAuth(env: PublicChatServerEnv) {
  return betterAuth(buildBetterAuthConfig(env) as never);
}

type PublicChatAuth = ReturnType<typeof createPublicChatAuth>;
const authCacheHost = globalThis as typeof globalThis & {
  __publicChatAuthInstanceCache?: Map<string, PublicChatAuth>;
};

function getAuthInstanceCache(): Map<string, PublicChatAuth> {
  if (!authCacheHost.__publicChatAuthInstanceCache) {
    authCacheHost.__publicChatAuthInstanceCache = new Map<
      string,
      PublicChatAuth
    >();
  }

  return authCacheHost.__publicChatAuthInstanceCache;
}

export function getPublicChatAuth(env: PublicChatServerEnv): PublicChatAuth {
  const cacheKey = [
    env.nodeEnv,
    env.appBaseUrl,
    env.databaseUrl,
    env.databaseSslMode,
    env.authSchema,
    env.betterAuthSecret,
  ].join("|");

  const cache = getAuthInstanceCache();
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const auth = createPublicChatAuth(env);
  cache.set(cacheKey, auth);
  return auth;
}
