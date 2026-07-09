export type AppApiEnvironment = "development" | "test" | "staging" | "production";
export type DatabaseSslMode = "disable" | "prefer" | "require";
export const DEFAULT_EXECUTION_CONTROL_TIMEOUT_MS = 30_000;
export const DEFAULT_EXECUTION_CONTROL_EVAL_TIMEOUT_MS = 30_000;

export interface HyperdriveBindingLike {
	connectionString?: string;
}

export interface WorkerFetchBindingLike {
	fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface Env {
	APP_API_NAME?: string;
	APP_API_ENVIRONMENT?: AppApiEnvironment;
	APP_API_WECHAT_OFFICIAL_ACCOUNT_COLLECTOR_TOKEN?: string;
	BETTER_AUTH_SECRET?: string;
	AUTH_SHELL_ORIGIN?: string;
	AUTH_TURNSTILE_SECRET_KEY?: string;
	RESEND_API_KEY?: string;
	AUTH_RESET_EMAIL_FROM?: string;
	AUTH_RESET_EMAIL_REPLY_TO?: string;
	EXECUTION_CONTROL_BASE_URL?: string;
	EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET?: string;
	EXECUTION_CONTROL_PRIVATE?: WorkerFetchBindingLike;
	EXECUTION_CONTROL_PRIVATE_ORIGIN?: string;
	EXECUTION_CONTROL_SHARED_SECRET?: string;
	EXECUTION_CONTROL_TIMEOUT_MS?: string;
	EXECUTION_CONTROL_EVAL_TIMEOUT_MS?: string;
	INGESTION_CONTROL_BASE_URL?: string;
	APP_API_OPERATOR_DATABASE_URL?: string;
	APP_API_DATABASE_SSLMODE?: DatabaseSslMode;
	APP_API_END_USER_EMAIL_DOMAIN_ALLOWLIST?: string;
	APP_API_END_USER_EMAIL_ALLOWLIST?: string;
	APP_API_OPERATOR_EMAIL_ALLOWLIST?: string;
	APP_API_PUBLIC_NOTICE_URL_ALLOWLIST?: string;
	APP_API_OPERATOR_SERVICE_ID_ALLOWLIST?: string;
	APP_API_OPERATOR_ISSUE_LINK_TEMPLATE?: string;
	APP_API_OPERATOR_TRACE_LINK_TEMPLATE?: string;
	APP_API_INTERNAL_SHARED_SECRET?: string;
	APP_API_STAGING_SMOKE_AUTH_SECRET?: string;
	APP_API_SAFETY_IDENTIFIER_HMAC_SECRET?: string;
	APP_API_PROVIDER_CONFIG_ENCRYPTION_KEY?: string;
	OBJECT_STORE_ACCESS_KEY?: string;
	OBJECT_STORE_BUCKET_SOURCE?: string;
	OBJECT_STORE_BUCKET_DERIVED?: string;
	OBJECT_STORE_DERIVED_ACCESS_KEY?: string;
	OBJECT_STORE_DERIVED_SECRET_KEY?: string;
	OBJECT_STORE_ENDPOINT?: string;
	OBJECT_STORE_REGION?: string;
	OBJECT_STORE_SECRET_KEY?: string;
	APP_API_OTEL_INGEST_ENDPOINT?: string;
	APP_API_OTEL_INGEST_SHARED_SECRET?: string;
	APP_API_DURABLE_CLOSEOUT_SWEEPER_ENABLED?: string;
	APP_API_REQUEST_PROJECTION_SWEEPER_ENABLED?: string;
	SENTRY_DSN?: string;
	SENTRY_ENVIRONMENT?: string;
	SENTRY_RELEASE?: string;
	APP_API_DB?: HyperdriveBindingLike;
	APP_API_DB_FRESH?: HyperdriveBindingLike;
}

export interface AppApiConfig {
	appName: string;
	environment: AppApiEnvironment;
	betterAuthSecret: string;
	authShellOrigin: string;
	authTurnstileSecretKey: string;
	resendApiKey: string;
	authResetEmailFrom: string;
	authResetEmailReplyTo?: string;
	databaseConnectionString: string;
	databaseSslMode: DatabaseSslMode;
	operatorDatabaseUrl?: string;
	internalSharedSecret: string;
	endUserEmailDomainAllowlist: string[];
	endUserEmailAllowlist: string[];
	operatorEmailAllowlist: string[];
	executionControlBaseUrl: string;
	executionControlSharedSecret: string;
	executionControlTimeoutMs: number;
	executionControlEvalTimeoutMs: number;
}

export interface AppAuthConfig {
	appName: string;
	environment: AppApiEnvironment;
	betterAuthSecret: string;
	authShellOrigin: string;
	authTurnstileSecretKey: string;
	resendApiKey: string;
	authResetEmailFrom: string;
	authResetEmailReplyTo?: string;
	endUserEmailDomainAllowlist: string[];
	endUserEmailAllowlist: string[];
}

const DEFAULT_APP_NAME = "app-api";
const MISSING_CONFIG_KEYS = [
	"APP_API_DB.connectionString",
	"BETTER_AUTH_SECRET",
	"AUTH_TURNSTILE_SECRET_KEY",
	"RESEND_API_KEY",
	"AUTH_RESET_EMAIL_FROM",
	"EXECUTION_CONTROL_UPSTREAM",
	"EXECUTION_CONTROL_SHARED_SECRET",
	"APP_API_END_USER_EMAIL_DOMAIN_ALLOWLIST",
	"APP_API_OPERATOR_EMAIL_ALLOWLIST",
	"APP_API_INTERNAL_SHARED_SECRET",
] as const;
const MISSING_AUTH_CONFIG_KEYS = [
	"BETTER_AUTH_SECRET",
	"AUTH_TURNSTILE_SECRET_KEY",
	"RESEND_API_KEY",
	"AUTH_RESET_EMAIL_FROM",
	"AUTH_SHELL_ORIGIN",
	"APP_API_END_USER_EMAIL_DOMAIN_ALLOWLIST",
] as const;

export function resolveAppName(env: Env): string {
	return env.APP_API_NAME?.trim() || DEFAULT_APP_NAME;
}

export function resolveEnvironment(env: Env): AppApiEnvironment {
	if (env.APP_API_ENVIRONMENT === "production") {
		return "production";
	}
	if (env.APP_API_ENVIRONMENT === "staging") {
		return "staging";
	}
	if (env.APP_API_ENVIRONMENT === "test") {
		return "test";
	}
	return "development";
}

export function isDeployedEnvironment(environment: AppApiEnvironment | undefined): boolean {
	return environment === "production" || environment === "staging";
}

export function resolveDatabaseSslMode(
	env: Pick<Env, "APP_API_DATABASE_SSLMODE">,
): DatabaseSslMode {
	if (env.APP_API_DATABASE_SSLMODE === "disable") {
		return "disable";
	}
	if (env.APP_API_DATABASE_SSLMODE === "prefer") {
		return "prefer";
	}
	return "require";
}

export function parseCsvList(value?: string): string[] {
	if (!value) {
		return [];
	}

	return value
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
}

export function readPublicNoticeURLAllowlist(
	env: Pick<Env, "APP_API_PUBLIC_NOTICE_URL_ALLOWLIST">,
): string[] {
	return parseCsvList(env.APP_API_PUBLIC_NOTICE_URL_ALLOWLIST).map((item) => item.toLowerCase());
}

export function parsePositiveInteger(value: string | undefined, defaultValue: number): number {
	if (!value?.trim()) {
		return defaultValue;
	}

	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed) || parsed < 1) {
		return defaultValue;
	}

	return parsed;
}

export function getMissingRuntimeConfig(env: Env): string[] {
	const missing: string[] = [];

	if (!env.APP_API_DB?.connectionString?.trim()) {
		missing.push(MISSING_CONFIG_KEYS[0]);
	}
	if (!env.BETTER_AUTH_SECRET?.trim()) {
		missing.push(MISSING_CONFIG_KEYS[1]);
	}
	if (!env.AUTH_TURNSTILE_SECRET_KEY?.trim()) {
		missing.push(MISSING_CONFIG_KEYS[2]);
	}
	if (!env.RESEND_API_KEY?.trim()) {
		missing.push(MISSING_CONFIG_KEYS[3]);
	}
	if (!env.AUTH_RESET_EMAIL_FROM?.trim()) {
		missing.push(MISSING_CONFIG_KEYS[4]);
	}
	if (!isExecutionControlUpstreamConfigured(env)) {
		missing.push(MISSING_CONFIG_KEYS[5]);
	}
	if (!env.EXECUTION_CONTROL_SHARED_SECRET?.trim()) {
		missing.push(MISSING_CONFIG_KEYS[6]);
	}
	if (parseCsvList(env.APP_API_END_USER_EMAIL_DOMAIN_ALLOWLIST).length === 0) {
		missing.push(MISSING_CONFIG_KEYS[7]);
	}
	if (parseCsvList(env.APP_API_OPERATOR_EMAIL_ALLOWLIST).length === 0) {
		missing.push(MISSING_CONFIG_KEYS[8]);
	}
	if (!env.APP_API_INTERNAL_SHARED_SECRET?.trim()) {
		missing.push(MISSING_CONFIG_KEYS[9]);
	}

	return missing;
}

function isExecutionControlUpstreamConfigured(
	env: Pick<
		Env,
		| "APP_API_ENVIRONMENT"
		| "EXECUTION_CONTROL_BASE_URL"
		| "EXECUTION_CONTROL_PRIVATE"
		| "EXECUTION_CONTROL_PRIVATE_ORIGIN"
	>,
): boolean {
	const environment = resolveEnvironment(env);
	if (isDeployedEnvironment(environment)) {
		return (
			typeof env.EXECUTION_CONTROL_PRIVATE?.fetch === "function" &&
			Boolean(env.EXECUTION_CONTROL_PRIVATE_ORIGIN?.trim())
		);
	}
	return Boolean(env.EXECUTION_CONTROL_BASE_URL?.trim());
}

export function getMissingAuthRuntimeConfig(env: Env): string[] {
	const missing: string[] = [];

	if (!env.BETTER_AUTH_SECRET?.trim()) {
		missing.push(MISSING_AUTH_CONFIG_KEYS[0]);
	}
	if (!env.AUTH_TURNSTILE_SECRET_KEY?.trim()) {
		missing.push(MISSING_AUTH_CONFIG_KEYS[1]);
	}
	if (!env.RESEND_API_KEY?.trim()) {
		missing.push(MISSING_AUTH_CONFIG_KEYS[2]);
	}
	if (!env.AUTH_RESET_EMAIL_FROM?.trim()) {
		missing.push(MISSING_AUTH_CONFIG_KEYS[3]);
	}
	if (!env.AUTH_SHELL_ORIGIN?.trim()) {
		missing.push(MISSING_AUTH_CONFIG_KEYS[4]);
	}
	if (parseCsvList(env.APP_API_END_USER_EMAIL_DOMAIN_ALLOWLIST).length === 0) {
		missing.push(MISSING_AUTH_CONFIG_KEYS[5]);
	}

	return missing;
}

export function readAuthShellOrigin(env: Pick<Env, "AUTH_SHELL_ORIGIN">): string {
	const origin = env.AUTH_SHELL_ORIGIN?.trim();
	if (!origin) {
		throw new Error("AUTH_SHELL_ORIGIN is required.");
	}

	return new URL(origin).origin;
}

function readRequiredTrimmedValue(value: string | null | undefined, key: string): string {
	const normalized = value?.trim();
	if (!normalized) {
		throw new Error(`${key} is required.`);
	}
	return normalized;
}

export function readAppAuthConfig(env: Env): AppAuthConfig {
	const missing = getMissingAuthRuntimeConfig(env);
	if (missing.length > 0) {
		throw new Error(`Missing auth runtime configuration: ${missing.join(", ")}`);
	}

	return {
		appName: resolveAppName(env),
		environment: resolveEnvironment(env),
		authShellOrigin: readAuthShellOrigin(env),
		betterAuthSecret: readRequiredTrimmedValue(env.BETTER_AUTH_SECRET, "BETTER_AUTH_SECRET"),
		authTurnstileSecretKey: readRequiredTrimmedValue(
			env.AUTH_TURNSTILE_SECRET_KEY,
			"AUTH_TURNSTILE_SECRET_KEY",
		),
		resendApiKey: readRequiredTrimmedValue(env.RESEND_API_KEY, "RESEND_API_KEY"),
		authResetEmailFrom: readRequiredTrimmedValue(
			env.AUTH_RESET_EMAIL_FROM,
			"AUTH_RESET_EMAIL_FROM",
		),
		authResetEmailReplyTo: env.AUTH_RESET_EMAIL_REPLY_TO?.trim() || undefined,
		endUserEmailDomainAllowlist: parseCsvList(env.APP_API_END_USER_EMAIL_DOMAIN_ALLOWLIST).map(
			(item) => item.toLowerCase(),
		),
		endUserEmailAllowlist: parseCsvList(env.APP_API_END_USER_EMAIL_ALLOWLIST).map((item) =>
			item.toLowerCase(),
		),
	};
}

export function readAppApiConfig(env: Env): AppApiConfig {
	const missing = getMissingRuntimeConfig(env);
	if (missing.length > 0) {
		throw new Error(`Missing runtime configuration: ${missing.join(", ")}`);
	}
	const authConfig = readAppAuthConfig(env);
	const databaseConnectionString = readRequiredTrimmedValue(
		env.APP_API_DB?.connectionString,
		"APP_API_DB.connectionString",
	);
	const internalSharedSecret = readRequiredTrimmedValue(
		env.APP_API_INTERNAL_SHARED_SECRET,
		"APP_API_INTERNAL_SHARED_SECRET",
	);
	const environment = resolveEnvironment(env);
	const executionControlBaseUrl = isDeployedEnvironment(environment)
		? readRequiredTrimmedValue(
				env.EXECUTION_CONTROL_PRIVATE_ORIGIN,
				"EXECUTION_CONTROL_PRIVATE_ORIGIN",
			)
		: readRequiredTrimmedValue(env.EXECUTION_CONTROL_BASE_URL, "EXECUTION_CONTROL_BASE_URL");
	const executionControlSharedSecret = readRequiredTrimmedValue(
		env.EXECUTION_CONTROL_SHARED_SECRET,
		"EXECUTION_CONTROL_SHARED_SECRET",
	);
	const executionControlTimeoutMs = parsePositiveInteger(
		env.EXECUTION_CONTROL_TIMEOUT_MS,
		DEFAULT_EXECUTION_CONTROL_TIMEOUT_MS,
	);
	const executionControlEvalTimeoutMs = parsePositiveInteger(
		env.EXECUTION_CONTROL_EVAL_TIMEOUT_MS,
		DEFAULT_EXECUTION_CONTROL_EVAL_TIMEOUT_MS,
	);

	return {
		...authConfig,
		databaseConnectionString,
		databaseSslMode: resolveDatabaseSslMode(env),
		internalSharedSecret,
		operatorDatabaseUrl: env.APP_API_OPERATOR_DATABASE_URL?.trim() || undefined,
		endUserEmailDomainAllowlist: parseCsvList(env.APP_API_END_USER_EMAIL_DOMAIN_ALLOWLIST).map(
			(item) => item.toLowerCase(),
		),
		endUserEmailAllowlist: parseCsvList(env.APP_API_END_USER_EMAIL_ALLOWLIST).map((item) =>
			item.toLowerCase(),
		),
		executionControlBaseUrl,
		executionControlSharedSecret,
		executionControlTimeoutMs,
		executionControlEvalTimeoutMs,
		operatorEmailAllowlist: parseCsvList(env.APP_API_OPERATOR_EMAIL_ALLOWLIST).map((item) =>
			item.toLowerCase(),
		),
	};
}
