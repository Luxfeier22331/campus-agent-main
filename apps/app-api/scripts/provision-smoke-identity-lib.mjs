import {
  buildEndUserEmailAdmissionPolicy,
  isEndUserEmailAllowedForAuth,
} from "../src/modules/auth/auth.ts";

const DEFAULT_PASSWORD_ENV_KEY = "APP_API_SMOKE_IDENTITY_PASSWORD";
const DEFAULT_APP_NAME = "campus-agent-app-api";
const DEFAULT_PUBLIC_CHAT_ORIGIN = "https://campus-chat-staging.ayafeed.com";
const DEFAULT_END_USER_EMAIL_DOMAIN_ALLOWLIST = "muc.edu.cn";
const DEFAULT_END_USER_EMAIL_ALLOWLIST = "help_bot@outlook.com";
const DEFAULT_OPERATOR_EMAIL_ALLOWLIST = "ops@example.com";
const DEFAULT_SUPERVISOR_BASE_URL = "https://supervisor.internal";
const DEFAULT_SUPERVISOR_SHARED_SECRET = "smoke-identity-supervisor-secret";
const DEFAULT_INTERNAL_SHARED_SECRET = "smoke-identity-internal-secret";
const DEFAULT_BETTER_AUTH_SECRET = "smoke-identity-secret-smoke-identity-secret";
const DEFAULT_RESEND_API_KEY = "smoke-identity-resend-key";
const DEFAULT_AUTH_RESET_EMAIL_FROM = "Campus Agent <auth@example.com>";

function readArgValue(argv, flag) {
  const index = argv.indexOf(flag);
  if (index === -1) {
    return null;
  }

  return argv[index + 1]?.trim() || null;
}

function parseDatabaseSslMode(value) {
  return value === "disable" || value === "prefer" ? value : "require";
}

function normalizePostgresConnectionStringForExplicitSsl(connectionString) {
  const normalized = requireValue(
    connectionString,
    "PostgreSQL connection string is required.",
  );
  const nextUrl = new URL(normalized);
  nextUrl.searchParams.delete("sslmode");
  return nextUrl.toString();
}

function requireValue(value, message) {
  if (!value?.trim()) {
    throw new Error(message);
  }

  return value.trim();
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function readSmokeIdentityProvisionInput(argv, env = process.env) {
  const email = requireValue(
    readArgValue(argv, "--email"),
    "Usage: --email <admitted smoke identity email> is required.",
  ).toLowerCase();
  const name = requireValue(
    readArgValue(argv, "--name"),
    "Usage: --name <display name> is required.",
  );
  const publicChatOrigin = env.PUBLIC_CHAT_WEB_ORIGIN?.trim() || DEFAULT_PUBLIC_CHAT_ORIGIN;
  const endUserEmailAllowlist =
    env.APP_API_END_USER_EMAIL_ALLOWLIST?.trim() || DEFAULT_END_USER_EMAIL_ALLOWLIST;
  const endUserEmailDomainAllowlist =
    env.APP_API_END_USER_EMAIL_DOMAIN_ALLOWLIST?.trim() ||
    DEFAULT_END_USER_EMAIL_DOMAIN_ALLOWLIST;
  const policy = buildEndUserEmailAdmissionPolicy({
    endUserEmailAllowlist: endUserEmailAllowlist.split(","),
    endUserEmailDomainAllowlist: endUserEmailDomainAllowlist.split(","),
  });
  if (!isEndUserEmailAllowedForAuth(email, policy)) {
    throw new Error(
      `${email} is not admitted by the configured end-user auth allowlist. Refuse to provision a smoke identity that the deployed surface cannot sign in with.`,
    );
  }
  const operatorDatabaseUrl = normalizePostgresConnectionStringForExplicitSsl(
    env.APP_API_OPERATOR_DATABASE_URL || env.APP_API_MANAGEMENT_DATABASE_URL,
  );
  const passwordEnvKey = readArgValue(argv, "--password-env") || DEFAULT_PASSWORD_ENV_KEY;
  const password = requireValue(
    env[passwordEnvKey],
    `${passwordEnvKey} is required and must contain the smoke identity password.`,
  );

  return {
    appApiEnvironment: env.APP_API_ENVIRONMENT?.trim() || "development",
    appName: env.APP_API_NAME?.trim() || DEFAULT_APP_NAME,
    betterAuthSecret: env.BETTER_AUTH_SECRET?.trim() || DEFAULT_BETTER_AUTH_SECRET,
    databaseSslMode: parseDatabaseSslMode(env.APP_API_DATABASE_SSLMODE?.trim()),
    email,
    endUserEmailAllowlist,
    endUserEmailDomainAllowlist,
    internalSharedSecret:
      env.APP_API_INTERNAL_SHARED_SECRET?.trim() || DEFAULT_INTERNAL_SHARED_SECRET,
    operatorDatabaseUrl,
    name,
    operatorEmailAllowlist:
      env.APP_API_OPERATOR_EMAIL_ALLOWLIST?.trim() || DEFAULT_OPERATOR_EMAIL_ALLOWLIST,
    password,
    passwordEnvKey,
    publicChatOrigin,
    supervisorApiBaseUrl:
      env.SUPERVISOR_API_BASE_URL?.trim() || DEFAULT_SUPERVISOR_BASE_URL,
    supervisorApiSharedSecret:
      env.SUPERVISOR_API_SHARED_SECRET?.trim() || DEFAULT_SUPERVISOR_SHARED_SECRET,
  };
}

export function buildSmokeIdentityProvisionRuntimeEnv(input) {
  return {
    APP_API_NAME: input.appName,
    APP_API_ENVIRONMENT: input.appApiEnvironment,
    APP_API_DATABASE_SSLMODE: input.databaseSslMode,
    APP_API_DB: {
      connectionString: input.operatorDatabaseUrl || input.managementDatabaseUrl,
    },
    APP_API_DB_FRESH: {
      connectionString: input.operatorDatabaseUrl || input.managementDatabaseUrl,
    },
    APP_API_END_USER_EMAIL_ALLOWLIST: input.endUserEmailAllowlist,
    APP_API_END_USER_EMAIL_DOMAIN_ALLOWLIST: input.endUserEmailDomainAllowlist,
    APP_API_INTERNAL_SHARED_SECRET: input.internalSharedSecret,
    APP_API_OPERATOR_DATABASE_URL: input.operatorDatabaseUrl || input.managementDatabaseUrl,
    APP_API_MANAGEMENT_DATABASE_URL: input.operatorDatabaseUrl || input.managementDatabaseUrl,
    APP_API_OPERATOR_EMAIL_ALLOWLIST: input.operatorEmailAllowlist,
    AUTH_RESET_EMAIL_FROM:
      input.authResetEmailFrom || DEFAULT_AUTH_RESET_EMAIL_FROM,
    BETTER_AUTH_SECRET: input.betterAuthSecret,
    PUBLIC_CHAT_WEB_ORIGIN: input.publicChatOrigin,
    RESEND_API_KEY: input.resendApiKey || DEFAULT_RESEND_API_KEY,
    SUPERVISOR_API_BASE_URL: input.supervisorApiBaseUrl,
    SUPERVISOR_API_SHARED_SECRET: input.supervisorApiSharedSecret,
  };
}

export async function provisionSmokeIdentity(input, deps) {
  const clearConversationsResult = await deps.executeSql(
    `
      delete from "chat"."conversations"
      where "owner_user_id" in (
        select "id" from "app_auth"."user" where "email" = $1
      )
    `,
    [input.email],
  );
  const deleteUserResult = await deps.executeSql(
    'delete from "app_auth"."user" where "email" = $1',
    [input.email],
  );

  const response = await deps.appFetch(
    new Request("https://app-api.internal/api/auth/sign-up/email", {
      body: JSON.stringify({
        email: input.email,
        name: input.name,
        password: input.password,
      }),
      headers: {
        "content-type": "application/json",
        origin: input.publicChatOrigin,
        referer: `${input.publicChatOrigin.replace(/\/$/, "")}/login`,
      },
      method: "POST",
    }),
  );

  const payload = await readJsonResponse(response);
  if (!response.ok) {
    const message =
      typeof payload === "string"
        ? payload
        : payload?.error?.message || payload?.message || "Unknown auth provisioning failure.";
    throw new Error(`Smoke identity sign-up failed (${response.status}): ${message}`);
  }

  const userId = payload?.user?.id;
  if (typeof userId !== "string" || !userId) {
    throw new Error("Smoke identity sign-up succeeded but did not return a canonical user id.");
  }

  const clearedSessionsResult = await deps.executeSql(
    'delete from "app_auth"."session" where "userId" = $1',
    [userId],
  );

  return {
    clearedConversationCount: clearConversationsResult.rowCount ?? 0,
    clearedSessionCount: clearedSessionsResult.rowCount ?? 0,
    deletedUserCount: deleteUserResult.rowCount ?? 0,
    email: input.email,
    userId,
  };
}

export async function provisionSmokeIdentityFromEnv(argv, env = process.env, deps) {
  const input = readSmokeIdentityProvisionInput(argv, env);
  const runtimeEnv = buildSmokeIdentityProvisionRuntimeEnv(input);
  if (!deps?.appFetch || !deps?.executeSql) {
    throw new Error(
      "provisionSmokeIdentityFromEnv requires appFetch and executeSql implementations.",
    );
  }

  return provisionSmokeIdentity(
    {
      ...input,
      runtimeEnv,
    },
    {
      appFetch: deps.appFetch,
      executeSql: deps.executeSql,
    },
  );
}
