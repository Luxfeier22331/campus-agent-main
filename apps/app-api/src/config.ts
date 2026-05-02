export type AppApiEnvironment = "development" | "test" | "staging" | "production";
export type DatabaseSslMode = "disable" | "prefer" | "require";
export const DEFAULT_SUPERVISOR_API_TIMEOUT_MS = 8_000;
export const DEFAULT_SUPERVISOR_API_EVAL_TIMEOUT_MS = 30_000;
export const DEFAULT_OFFICIAL_WEB_HANDOFF_TIMEOUT_MS = 8_000;

export interface HyperdriveBindingLike {
	connectionString?: string;
}

export interface Env {
	APP_API_NAME?: string;
	APP_API_ENVIRONMENT?: AppApiEnvironment;
	APP_API_OFFICIAL_WEB_HANDOFF_TIMEOUT_MS?: string;
	APP_API_OFFICIAL_WEB_HANDOFF_TOKEN?: string;
	APP_API_OFFICIAL_WEB_HANDOFF_URL?: string;
	APP_API_OFFICIAL_WEB_COLLECTOR_TOKEN?: string;
	APP_API_WECHAT_OFFICIAL_ACCOUNT_COLLECTOR_TOKEN?: string;
	BETTER_AUTH_SECRET?: string;
	AUTH_SHELL_ORIGIN?: string;
	AUTH_TURNSTILE_SECRET_KEY?: string;
	RESEND_API_KEY?: string;
	AUTH_RESET_EMAIL_FROM?: string;
	AUTH_RESET_EMAIL_REPLY_TO?: string;
	PUBLIC_CHAT_WEB_ORIGIN?: string;
	SUPERVISOR_API_ACCESS_CLIENT_ID?: string;
	SUPERVISOR_API_ACCESS_CLIENT_SECRET?: string;
	SUPERVISOR_API_BASE_URL?: string;
	SUPERVISOR_API_SHARED_SECRET?: string;
	SUPERVISOR_API_TIMEOUT_MS?: string;
	SUPERVISOR_API_EVAL_TIMEOUT_MS?: string;
	APP_API_OPERATOR_DATABASE_URL?: string;
	APP_API_MANAGEMENT_DATABASE_URL?: string;
	APP_API_DATABASE_SSLMODE?: DatabaseSslMode;
	APP_API_END_USER_EMAIL_DOMAIN_ALLOWLIST?: string;
	APP_API_END_USER_EMAIL_ALLOWLIST?: string;
	APP_API_OPERATOR_EMAIL_ALLOWLIST?: string;
	APP_API_OPERATOR_ISSUE_LINK_TEMPLATE?: string;
	APP_API_OPERATOR_TRACE_LINK_TEMPLATE?: string;
	APP_API_INTERNAL_SHARED_SECRET?: string;
	APP_API_STAGING_SMOKE_AUTH_SECRET?: string;
	APP_API_SAFETY_IDENTIFIER_HMAC_SECRET?: string;
	AXIOM_DATASET?: string;
	AXIOM_ENDPOINT?: string;
	AXIOM_TOKEN?: string;
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
	publicChatOrigin: string;
	databaseConnectionString: string;
	databaseSslMode: DatabaseSslMode;
	operatorDatabaseUrl?: string;
	internalSharedSecret: string;
	endUserEmailDomainAllowlist: string[];
	endUserEmailAllowlist: string[];
	operatorEmailAllowlist: string[];
	supervisorApiBaseUrl: string;
	supervisorApiSharedSecret: string;
	supervisorApiTimeoutMs: number;
	supervisorApiEvalTimeoutMs: number;
}

const DEFAULT_APP_NAME = "app-api";
const MISSING_CONFIG_KEYS = [
	"APP_API_DB.connectionString",
	"BETTER_AUTH_SECRET",
	"AUTH_TURNSTILE_SECRET_KEY",
	"RESEND_API_KEY",
	"AUTH_RESET_EMAIL_FROM",
	"PUBLIC_CHAT_WEB_ORIGIN",
	"SUPERVISOR_API_BASE_URL",
	"SUPERVISOR_API_SHARED_SECRET",
	"APP_API_END_USER_EMAIL_DOMAIN_ALLOWLIST",
	"APP_API_OPERATOR_EMAIL_ALLOWLIST",
	"APP_API_INTERNAL_SHARED_SECRET",
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

export function parsePositiveInteger(value: string | undefined, fallback: number): number {
	if (!value?.trim()) {
		return fallback;
	}

	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed) || parsed < 1) {
		return fallback;
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
	if (!env.PUBLIC_CHAT_WEB_ORIGIN?.trim()) {
		missing.push(MISSING_CONFIG_KEYS[5]);
	}
	if (!env.SUPERVISOR_API_BASE_URL?.trim()) {
		missing.push(MISSING_CONFIG_KEYS[6]);
	}
	if (!env.SUPERVISOR_API_SHARED_SECRET?.trim()) {
		missing.push(MISSING_CONFIG_KEYS[7]);
	}
	if (parseCsvList(env.APP_API_END_USER_EMAIL_DOMAIN_ALLOWLIST).length === 0) {
		missing.push(MISSING_CONFIG_KEYS[8]);
	}
	if (parseCsvList(env.APP_API_OPERATOR_EMAIL_ALLOWLIST).length === 0) {
		missing.push(MISSING_CONFIG_KEYS[9]);
	}
	if (!env.APP_API_INTERNAL_SHARED_SECRET?.trim()) {
		missing.push(MISSING_CONFIG_KEYS[10]);
	}

	return missing;
}

export function readPublicChatOrigin(env: Pick<Env, "PUBLIC_CHAT_WEB_ORIGIN">): string {
	const origin = env.PUBLIC_CHAT_WEB_ORIGIN?.trim();
	if (!origin) {
		throw new Error("PUBLIC_CHAT_WEB_ORIGIN is required.");
	}

	return new URL(origin).origin;
}

export function readAuthShellOrigin(
	env: Pick<Env, "AUTH_SHELL_ORIGIN" | "PUBLIC_CHAT_WEB_ORIGIN">,
): string {
	const origin = env.AUTH_SHELL_ORIGIN?.trim() || env.PUBLIC_CHAT_WEB_ORIGIN?.trim();
	if (!origin) {
		throw new Error("AUTH_SHELL_ORIGIN or PUBLIC_CHAT_WEB_ORIGIN is required.");
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

export function readAppApiConfig(env: Env): AppApiConfig {
	const missing = getMissingRuntimeConfig(env);
	if (missing.length > 0) {
		throw new Error(`Missing runtime configuration: ${missing.join(", ")}`);
	}

	const betterAuthSecret = readRequiredTrimmedValue(env.BETTER_AUTH_SECRET, "BETTER_AUTH_SECRET");
	const authTurnstileSecretKey = readRequiredTrimmedValue(
		env.AUTH_TURNSTILE_SECRET_KEY,
		"AUTH_TURNSTILE_SECRET_KEY",
	);
	const resendApiKey = readRequiredTrimmedValue(env.RESEND_API_KEY, "RESEND_API_KEY");
	const authResetEmailFrom = readRequiredTrimmedValue(
		env.AUTH_RESET_EMAIL_FROM,
		"AUTH_RESET_EMAIL_FROM",
	);
	const databaseConnectionString = readRequiredTrimmedValue(
		env.APP_API_DB?.connectionString,
		"APP_API_DB.connectionString",
	);
	const internalSharedSecret = readRequiredTrimmedValue(
		env.APP_API_INTERNAL_SHARED_SECRET,
		"APP_API_INTERNAL_SHARED_SECRET",
	);
	const supervisorApiBaseUrl = readRequiredTrimmedValue(
		env.SUPERVISOR_API_BASE_URL,
		"SUPERVISOR_API_BASE_URL",
	);
	const supervisorApiSharedSecret = readRequiredTrimmedValue(
		env.SUPERVISOR_API_SHARED_SECRET,
		"SUPERVISOR_API_SHARED_SECRET",
	);

	return {
		appName: resolveAppName(env),
		environment: resolveEnvironment(env),
		authShellOrigin: readAuthShellOrigin(env),
		betterAuthSecret,
		authTurnstileSecretKey,
		resendApiKey,
		authResetEmailFrom,
		authResetEmailReplyTo: env.AUTH_RESET_EMAIL_REPLY_TO?.trim() || undefined,
		publicChatOrigin: readPublicChatOrigin(env),
		databaseConnectionString,
		databaseSslMode: resolveDatabaseSslMode(env),
		internalSharedSecret,
		operatorDatabaseUrl:
			env.APP_API_OPERATOR_DATABASE_URL?.trim() ||
			env.APP_API_MANAGEMENT_DATABASE_URL?.trim() ||
			undefined,
		endUserEmailDomainAllowlist: parseCsvList(env.APP_API_END_USER_EMAIL_DOMAIN_ALLOWLIST).map(
			(item) => item.toLowerCase(),
		),
		endUserEmailAllowlist: parseCsvList(env.APP_API_END_USER_EMAIL_ALLOWLIST).map((item) =>
			item.toLowerCase(),
		),
		supervisorApiBaseUrl,
		supervisorApiSharedSecret,
		operatorEmailAllowlist: parseCsvList(env.APP_API_OPERATOR_EMAIL_ALLOWLIST).map((item) =>
			item.toLowerCase(),
		),
		supervisorApiTimeoutMs: parsePositiveInteger(
			env.SUPERVISOR_API_TIMEOUT_MS,
			DEFAULT_SUPERVISOR_API_TIMEOUT_MS,
		),
		supervisorApiEvalTimeoutMs: parsePositiveInteger(
			env.SUPERVISOR_API_EVAL_TIMEOUT_MS,
			DEFAULT_SUPERVISOR_API_EVAL_TIMEOUT_MS,
		),
	};
}
