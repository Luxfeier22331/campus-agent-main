export type AppApiEnvironment = "development" | "test" | "staging" | "production";
export type DatabaseSslMode = "disable" | "prefer" | "require";
export const DEFAULT_EXECUTION_CONTROL_TIMEOUT_MS = 30_000;
export const DEFAULT_PROFILE_MEMORY_COMMAND_TIMEOUT_MS = 120_000;

export interface HyperdriveBindingLike {
	connectionString?: string;
}

export interface WorkerFetchBindingLike {
	fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface Env {
	APP_API_NAME?: string;
	APP_API_ENVIRONMENT?: AppApiEnvironment;
	BETTER_AUTH_SECRET?: string;
	AUTH_SHELL_ORIGIN?: string;
	AUTH_TURNSTILE_SECRET_KEY?: string;
	RESEND_API_KEY?: string;
	AUTH_RESET_EMAIL_FROM?: string;
	AUTH_RESET_EMAIL_REPLY_TO?: string;
	EXECUTION_CONTROL_BASE_URL?: string;
	EXECUTION_CONTROL_PRIVATE?: WorkerFetchBindingLike;
	EXECUTION_CONTROL_PRIVATE_ORIGIN?: string;
	APP_API_EXECUTION_SHARED_SECRET?: string;
	OPS_WEB_INTERNAL_TOKEN?: string;
	EXECUTION_CONTROL_TIMEOUT_MS?: string;
	APP_API_DATABASE_SSLMODE?: DatabaseSslMode;
	APP_API_END_USER_EMAIL_DOMAIN_ALLOWLIST?: string;
	APP_API_END_USER_EMAIL_ALLOWLIST?: string;
	APP_API_PUBLIC_NOTICE_URL_ALLOWLIST?: string;
	APP_API_STAGING_SMOKE_AUTH_SECRET?: string;
	APP_API_SAFETY_IDENTIFIER_HMAC_SECRET?: string;
	OBJECT_STORE_DERIVED_PUBLIC_BASE_URL?: string;
	APP_API_PROFILE_MEMORY_COMMAND_SWEEPER_ENABLED?: string;
	APP_API_PROFILE_MEMORY_COMMAND_TIMEOUT_MS?: string;
	SENTRY_DSN?: string;
	SENTRY_ENVIRONMENT?: string;
	SENTRY_RELEASE?: string;
	APP_API_DB?: HyperdriveBindingLike;
	APP_API_DB_FRESH?: HyperdriveBindingLike;
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
	"APP_API_DB_FRESH.connectionString",
	"BETTER_AUTH_SECRET",
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
	if (!env.APP_API_DB_FRESH?.connectionString?.trim()) {
		missing.push(MISSING_CONFIG_KEYS[1]);
	}
	if (!env.BETTER_AUTH_SECRET?.trim()) {
		missing.push(MISSING_CONFIG_KEYS[2]);
	}
	return missing;
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
