export type AppApiEnvironment = "development" | "test" | "staging" | "production";
export type DatabaseSslMode = "disable" | "prefer" | "require";
export const APP_API_NAME = "campus-agent-app-api";
export const EXECUTION_CONTROL_TIMEOUT_MS = 95_000;
export const PROFILE_MEMORY_COMMAND_TIMEOUT_MS = 120_000;
export const END_USER_EMAIL_DOMAIN_ALLOWLIST = ["muc.edu.cn"] as const;
export const END_USER_EMAIL_ALLOWLIST = ["help_bot@outlook.com"] as const;

export interface HyperdriveBindingLike {
	connectionString?: string;
}

export interface WorkerFetchBindingLike {
	fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface Env {
	APP_API_ENVIRONMENT?: AppApiEnvironment;
	BETTER_AUTH_SECRET?: string;
	AUTH_SHELL_ORIGIN?: string;
	AUTH_TURNSTILE_SECRET_KEY?: string;
	RESEND_API_KEY?: string;
	AUTH_RESET_EMAIL_FROM?: string;
	EXECUTION_CONTROL_BASE_URL?: string;
	EXECUTION_CONTROL_PRIVATE?: WorkerFetchBindingLike;
	EXECUTION_CONTROL_PRIVATE_ORIGIN?: string;
	OBJECT_STORE_PRIVATE?: WorkerFetchBindingLike;
	OBJECT_STORE_LOCAL_BASE_URL?: string;
	APP_API_EXECUTION_SHARED_SECRET?: string;
	OPS_WEB_INTERNAL_TOKEN?: string;
	APP_API_DATABASE_SSLMODE?: DatabaseSslMode;
	APP_API_STAGING_SMOKE_AUTH_SECRET?: string;
	APP_API_SAFETY_IDENTIFIER_HMAC_SECRET?: string;
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
	endUserEmailDomainAllowlist: string[];
	endUserEmailAllowlist: string[];
}

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
] as const;

export function resolveAppName(): string {
	return APP_API_NAME;
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
		appName: resolveAppName(),
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
		endUserEmailDomainAllowlist: [...END_USER_EMAIL_DOMAIN_ALLOWLIST],
		endUserEmailAllowlist: [...END_USER_EMAIL_ALLOWLIST],
	};
}
