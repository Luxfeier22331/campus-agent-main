import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

import {
  isDeployedEnvironment,
  readAppApiConfig,
  readPublicChatOrigin,
  resolveEnvironment,
  type AppApiEnvironment,
  type Env,
} from "../../config";
import { decodeBase64UrlBytes, encodeBase64UrlBytes } from "../../base64url";
import { createRuntimeDatabase, probeBetterAuthDatabase } from "../../db/runtime";
import { appAuthSchema } from "../../db/schema";

const AUTH_SESSION_EXPIRES_IN = 60 * 60 * 24 * 7;
const AUTH_SESSION_UPDATE_AGE = 60 * 60 * 24;
const AUTH_RATE_LIMIT_WINDOW = 60;
const AUTH_RATE_LIMIT_MAX = 10;
const APP_PASSWORD_HASH_VERSION = "pbkdf2_sha256";
// Deployed workerd enforces a 100k PBKDF2 iteration ceiling.
const APP_PASSWORD_PBKDF2_ITERATIONS = 100_000;
const APP_PASSWORD_PBKDF2_MAX_ITERATIONS = 100_000;
const APP_PASSWORD_SALT_BYTES = 16;
const APP_PASSWORD_KEY_BYTES = 32;
const appAuthCache = new WeakMap<Env, Promise<AppAuth>>();
const passwordTextEncoder = new TextEncoder();

function shouldCacheAppAuth(env: Env): boolean {
  return resolveEnvironment(env) === "test";
}

export interface BetterAuthConfigInput {
  appName: string;
  betterAuthSecret: string;
  environment: AppApiEnvironment;
  publicChatOrigin: string;
  database: object;
}

export interface CreateAppAuthInput {
  database?: Awaited<ReturnType<typeof createRuntimeDatabase>>;
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
      password: {
        hash: hashAppPassword,
        verify: verifyAppPassword,
      },
    },
    database: input.database,
    rateLimit: {
      enabled: isDeployedEnvironment(input.environment),
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

function normalizePassword(value: string): string {
  return value.normalize("NFKC");
}

async function deriveAppPasswordKey(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const saltBytes = salt as unknown as BufferSource;
  const key = await crypto.subtle.importKey(
    "raw",
    passwordTextEncoder.encode(normalizePassword(password)),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      hash: "SHA-256",
      iterations,
      name: "PBKDF2",
      salt: saltBytes,
    },
    key,
    APP_PASSWORD_KEY_BYTES * 8,
  );

  return new Uint8Array(derivedBits);
}

function constantTimeEqualBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) {
    return false;
  }

  let diff = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    diff |= left[index]! ^ right[index]!;
  }

  return diff === 0;
}

export async function hashAppPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(APP_PASSWORD_SALT_BYTES));
  const key = await deriveAppPasswordKey(password, salt, APP_PASSWORD_PBKDF2_ITERATIONS);

  return [
    APP_PASSWORD_HASH_VERSION,
    String(APP_PASSWORD_PBKDF2_ITERATIONS),
    encodeBase64UrlBytes(salt),
    encodeBase64UrlBytes(key),
  ].join("$");
}

export async function verifyAppPassword(input: {
  hash: string;
  password: string;
}): Promise<boolean> {
  const [version, iterationsRaw, saltEncoded, keyEncoded] = input.hash.split("$");
  if (
    version !== APP_PASSWORD_HASH_VERSION ||
    !iterationsRaw ||
    !saltEncoded ||
    !keyEncoded
  ) {
    return false;
  }

  const iterations = Number.parseInt(iterationsRaw, 10);
  if (
    !Number.isFinite(iterations) ||
    iterations < 1 ||
    iterations > APP_PASSWORD_PBKDF2_MAX_ITERATIONS
  ) {
    return false;
  }

  const salt = decodeBase64UrlBytes(saltEncoded);
  const expectedKey = decodeBase64UrlBytes(keyEncoded);
  if (salt.byteLength !== APP_PASSWORD_SALT_BYTES || expectedKey.byteLength !== APP_PASSWORD_KEY_BYTES) {
    return false;
  }

  const derivedKey = await deriveAppPasswordKey(input.password, salt, iterations);

  return constantTimeEqualBytes(derivedKey, expectedKey);
}

export async function createAppAuth(env: Env, input: CreateAppAuthInput = {}) {
  const config = readAppApiConfig(env);
  const database = input.database ?? (await createRuntimeDatabase(env, { consistency: "fresh" }));

  return betterAuth(
    buildBetterAuthConfig({
      appName: config.appName,
      betterAuthSecret: config.betterAuthSecret,
      environment: config.environment,
      publicChatOrigin: readPublicChatOrigin(env),
      database: drizzleAdapter(database, {
        camelCase: true,
        provider: "pg",
        schema: appAuthSchema,
      }),
    }) as never,
  );
}

export type AppAuth = Awaited<ReturnType<typeof createAppAuth>>;
export type AppAuthGetter = () => Promise<AppAuth>;

export interface AppAuthResolutionInput {
  getAppAuth?: AppAuthGetter;
}

export async function getAppAuth(env: Env): Promise<AppAuth> {
  if (!shouldCacheAppAuth(env)) {
    return createAppAuth(env);
  }

  const cached = appAuthCache.get(env);
  if (cached) {
    return cached;
  }

  const authPromise = createAppAuth(env);
  appAuthCache.set(env, authPromise);
  return authPromise;
}

export async function handleAuthRequest(
  request: Request,
  env: Env,
  input: AppAuthResolutionInput = {},
): Promise<Response> {
  const auth = input.getAppAuth ? await input.getAppAuth() : await getAppAuth(env);
  return auth.handler(request);
}

export async function probeAppAuthRuntime(env: Env): Promise<void> {
  await probeBetterAuthDatabase(env);
}
