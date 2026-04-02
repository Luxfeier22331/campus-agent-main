import { betterAuth } from "better-auth";

import { readAppApiConfig, readPublicChatOrigin, type Env } from "../../config";

const AUTH_SESSION_EXPIRES_IN = 60 * 60 * 24 * 7;
const AUTH_SESSION_UPDATE_AGE = 60 * 60 * 24;
const AUTH_RATE_LIMIT_WINDOW = 60;
const AUTH_RATE_LIMIT_MAX = 10;

export interface BetterAuthConfigInput {
  appName: string;
  betterAuthSecret: string;
  environment: "development" | "test" | "production";
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
    rateLimit: {
      enabled: input.environment === "production",
      max: AUTH_RATE_LIMIT_MAX,
      storage: "memory",
      window: AUTH_RATE_LIMIT_WINDOW,
    },
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
          environment: config.environment,
          publicChatOrigin: readPublicChatOrigin(env),
          database: await createBetterAuthPool(env),
        }) as never,
  );
}

type AppAuth = Awaited<ReturnType<typeof createAppAuth>>;

export async function getAppAuth(env: Env): Promise<AppAuth> {
  return createAppAuth(env);
}

export async function handleAuthRequest(request: Request, env: Env): Promise<Response> {
  const auth = await getAppAuth(env);
  return auth.handler(request);
}
