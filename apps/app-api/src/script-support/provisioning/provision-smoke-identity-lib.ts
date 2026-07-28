import { isCampusEmail } from "../../modules/auth/campus-access.ts";

const DEFAULT_PASSWORD_ENV_KEY = "APP_API_SMOKE_IDENTITY_PASSWORD";
const DEFAULT_AUTH_SHELL_ORIGIN = "https://campus-staging.mucwiki-edge.link";
const DEFAULT_EXECUTION_CONTROL_BASE_URL = "https://execution-control.internal";
const DEFAULT_APP_API_EXECUTION_SHARED_SECRET = "smoke-identity-execution-secret";
const DEFAULT_BETTER_AUTH_SECRET = "smoke-identity-secret-smoke-identity-secret";
const DEFAULT_TURNSTILE_TEST_SECRET_KEY = "1x0000000000000000000000000000000AA";
const DEFAULT_TURNSTILE_TEST_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
const DEFAULT_RESEND_API_KEY = "smoke-identity-resend-key";
const DEFAULT_AUTH_EMAIL_FROM = "Campus Agent <auth@example.com>";

type DatabaseSslMode = "disable" | "prefer" | "require";

interface SqlResult {
	rowCount?: number | null;
}

interface SmokeIdentityProvisionInput {
	appApiEnvironment: string;
	authEmailFrom?: string;
	authShellOrigin: string;
	authTurnstileSecretKey: string;
	betterAuthSecret: string;
	captchaToken: string;
	databaseSslMode: DatabaseSslMode;
	email: string;
	executionControlBaseUrl: string;
	appApiExecutionSharedSecret: string;
	name: string;
	schemaDatabaseUrl: string;
	password: string;
	passwordEnvKey: string;
	resendApiKey?: string;
	[key: string]: unknown;
}

interface SmokeIdentityProvisionRuntimeEnv {
	APP_API_EXECUTION_SHARED_SECRET: string;
	APP_API_DB: { connectionString: string };
	APP_API_DB_FRESH: { connectionString: string };
	[key: string]: unknown;
}

interface SmokeIdentityProvisionDeps {
	appFetch(request: Request): Promise<Response> | Response;
	executeSql(sql: string, params?: unknown[]): Promise<SqlResult>;
}

function readArgValue(argv: string[], flag: string): string | null {
	const index = argv.indexOf(flag);
	if (index === -1) {
		return null;
	}

	return argv[index + 1]?.trim() || null;
}

function parseDatabaseSslMode(value: string | undefined): DatabaseSslMode {
	return value === "disable" || value === "prefer" ? value : "require";
}

function normalizePostgresConnectionStringForExplicitSsl(
	connectionString: string | undefined,
): string {
	const normalized = requireValue(connectionString, "PostgreSQL connection string is required.");
	const nextUrl = new URL(normalized);
	nextUrl.searchParams.delete("sslmode");
	return nextUrl.toString();
}

function requireValue(value: string | null | undefined, message: string): string {
	if (!value?.trim()) {
		throw new Error(message);
	}

	return value.trim();
}

function shouldUseLocalTurnstileTestingDefaults(
	appApiEnvironment: string,
	authShellOrigin: string,
): boolean {
	if (appApiEnvironment === "development" || appApiEnvironment === "test") {
		return true;
	}

	return /^(https?:\/\/)(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/i.test(authShellOrigin);
}

function resolveTurnstileSecretKey(
	env: NodeJS.ProcessEnv,
	appApiEnvironment: string,
	authShellOrigin: string,
): string {
	const configuredSecret = env.AUTH_TURNSTILE_SECRET_KEY?.trim();
	if (configuredSecret) {
		return configuredSecret;
	}

	if (shouldUseLocalTurnstileTestingDefaults(appApiEnvironment, authShellOrigin)) {
		return DEFAULT_TURNSTILE_TEST_SECRET_KEY;
	}

	throw new Error(
		"AUTH_TURNSTILE_SECRET_KEY is required when provisioning a non-local smoke identity.",
	);
}

function resolveSmokeCaptchaToken(env: NodeJS.ProcessEnv, authTurnstileSecretKey: string): string {
	const explicitToken = env.APP_API_SMOKE_IDENTITY_CAPTCHA_TOKEN?.trim();
	if (explicitToken) {
		return explicitToken;
	}

	if (authTurnstileSecretKey === DEFAULT_TURNSTILE_TEST_SECRET_KEY) {
		return DEFAULT_TURNSTILE_TEST_TOKEN;
	}

	throw new Error(
		"APP_API_SMOKE_IDENTITY_CAPTCHA_TOKEN is required when AUTH_TURNSTILE_SECRET_KEY is not the Cloudflare testing secret key.",
	);
}

async function readJsonResponse(response: Response): Promise<unknown> {
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

function objectPayload(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function readSmokeIdentityProvisionInput(
	argv: string[],
	env: NodeJS.ProcessEnv = process.env,
): SmokeIdentityProvisionInput {
	const appApiEnvironment = env.APP_API_ENVIRONMENT?.trim() || "development";
	const email = requireValue(
		readArgValue(argv, "--email"),
		"Usage: --email <admitted smoke identity email> is required.",
	).toLowerCase();
	const name = requireValue(
		readArgValue(argv, "--name"),
		"Usage: --name <display name> is required.",
	);
	const authShellOrigin = env.AUTH_SHELL_ORIGIN?.trim() || DEFAULT_AUTH_SHELL_ORIGIN;
	const authTurnstileSecretKey = resolveTurnstileSecretKey(env, appApiEnvironment, authShellOrigin);
	if (!isCampusEmail(email)) {
		throw new Error(
			`${email} is not a muc.edu.cn address. The smoke identity must use a campus email.`,
		);
	}
	const schemaDatabaseUrl = normalizePostgresConnectionStringForExplicitSsl(
		env.APP_API_SCHEMA_DATABASE_URL,
	);
	const passwordEnvKey = readArgValue(argv, "--password-env") || DEFAULT_PASSWORD_ENV_KEY;
	const password = requireValue(
		env[passwordEnvKey],
		`${passwordEnvKey} is required and must contain the smoke identity password.`,
	);

	return {
		appApiEnvironment,
		authTurnstileSecretKey,
		betterAuthSecret: env.BETTER_AUTH_SECRET?.trim() || DEFAULT_BETTER_AUTH_SECRET,
		captchaToken: resolveSmokeCaptchaToken(env, authTurnstileSecretKey),
		databaseSslMode: parseDatabaseSslMode(env.APP_API_DATABASE_SSLMODE?.trim()),
		email,
		appApiExecutionSharedSecret:
			env.APP_API_EXECUTION_SHARED_SECRET?.trim() || DEFAULT_APP_API_EXECUTION_SHARED_SECRET,
		schemaDatabaseUrl,
		name,
		password,
		passwordEnvKey,
		authShellOrigin,
		executionControlBaseUrl:
			env.EXECUTION_CONTROL_BASE_URL?.trim() || DEFAULT_EXECUTION_CONTROL_BASE_URL,
	};
}

export function buildSmokeIdentityProvisionRuntimeEnv(
	input: SmokeIdentityProvisionInput,
): SmokeIdentityProvisionRuntimeEnv {
	const schemaDatabaseUrl = requireValue(
		input.schemaDatabaseUrl,
		"schemaDatabaseUrl is required for smoke identity provisioning.",
	);
	return {
		APP_API_ENVIRONMENT: input.appApiEnvironment,
		APP_API_DATABASE_SSLMODE: input.databaseSslMode,
		APP_API_DB: {
			connectionString: schemaDatabaseUrl,
		},
		APP_API_DB_FRESH: {
			connectionString: schemaDatabaseUrl,
		},
		APP_API_EXECUTION_SHARED_SECRET: input.appApiExecutionSharedSecret,
		APP_API_SCHEMA_DATABASE_URL: schemaDatabaseUrl,
		AUTH_EMAIL_FROM: input.authEmailFrom || DEFAULT_AUTH_EMAIL_FROM,
		AUTH_TURNSTILE_SECRET_KEY: input.authTurnstileSecretKey,
		BETTER_AUTH_SECRET: input.betterAuthSecret,
		AUTH_SHELL_ORIGIN: input.authShellOrigin,
		RESEND_API_KEY: input.resendApiKey || DEFAULT_RESEND_API_KEY,
		EXECUTION_CONTROL_BASE_URL: input.executionControlBaseUrl,
	};
}

export async function provisionSmokeIdentity(
	input: SmokeIdentityProvisionInput & { runtimeEnv?: SmokeIdentityProvisionRuntimeEnv },
	deps: SmokeIdentityProvisionDeps,
) {
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
				origin: input.authShellOrigin,
				referer: `${input.authShellOrigin.replace(/\/$/, "")}/login`,
				"x-campus-legal-accepted": "terms-and-privacy",
				"x-captcha-response": input.captchaToken,
			},
			method: "POST",
		}),
	);

	const payload = await readJsonResponse(response);
	if (!response.ok) {
		const payloadObject = objectPayload(payload);
		const errorObject = objectPayload(payloadObject.error);
		const message =
			typeof payload === "string"
				? payload
				: errorObject.message || payloadObject.message || "Unknown auth provisioning failure.";
		throw new Error(`Smoke identity sign-up failed (${response.status}): ${message}`);
	}

	const payloadObject = objectPayload(payload);
	const userObject = objectPayload(payloadObject.user);
	const userId = userObject.id;
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

export async function provisionSmokeIdentityFromEnv(
	argv: string[],
	deps: Partial<SmokeIdentityProvisionDeps>,
	env: NodeJS.ProcessEnv = process.env,
) {
	const input = readSmokeIdentityProvisionInput(argv, env);
	const runtimeEnv = buildSmokeIdentityProvisionRuntimeEnv(input);
	if (!(deps?.appFetch && deps?.executeSql)) {
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
