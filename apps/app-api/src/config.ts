export type AppApiEnvironment = "development" | "test" | "staging" | "production";
export const APP_API_NAME = "campus-agent-app-api";
export const EXECUTION_CONTROL_TIMEOUT_MS = 95_000;
export const PROFILE_MEMORY_COMMAND_TIMEOUT_MS = 120_000;

export interface HyperdriveBindingLike {
	connectionString?: string;
}

export interface WorkerFetchBindingLike {
	fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface Env {
	DEPLOYMENT_ENVIRONMENT?: string;
	DEPLOYMENT_RELEASE?: string;
	BETTER_AUTH_SECRET?: string;
	AUTH_SHELL_ORIGIN?: string;
	AUTH_TURNSTILE_SECRET_KEY?: string;
	RESEND_API_KEY?: string;
	AUTH_EMAIL_FROM?: string;
	AUTH_EMAIL_REPLY_TO?: string;
	EXECUTION_CONTROL_BASE_URL?: string;
	EXECUTION_CONTROL_PRIVATE?: WorkerFetchBindingLike;
	EXECUTION_CONTROL_PRIVATE_ORIGIN?: string;
	OBJECT_STORE_PRIVATE?: WorkerFetchBindingLike;
	OBJECT_STORE_LOCAL_BASE_URL?: string;
	APP_API_EXECUTION_SHARED_SECRET?: string;
	OPS_WEB_INTERNAL_TOKEN?: string;
	APP_API_SAFETY_IDENTIFIER_HMAC_SECRET?: string;
	SENTRY_DSN?: string;
	APP_API_DB?: HyperdriveBindingLike;
}

export interface AppAuthConfig {
	appName: string;
	environment: AppApiEnvironment;
	betterAuthSecret: string;
	authShellOrigin: string;
	authTurnstileSecretKey: string;
}

export interface AppAuthEmailConfig {
	resendApiKey: string;
	authEmailFrom: string;
	authEmailReplyTo?: string;
}

const MISSING_CONFIG_KEYS = [
	"APP_API_DB.connectionString",
	"DEPLOYMENT_ENVIRONMENT",
	"BETTER_AUTH_SECRET",
	"AUTH_TURNSTILE_SECRET_KEY",
	"AUTH_SHELL_ORIGIN",
	"APP_API_SAFETY_IDENTIFIER_HMAC_SECRET",
] as const;
const MISSING_AUTH_CONFIG_KEYS = [
	"BETTER_AUTH_SECRET",
	"AUTH_TURNSTILE_SECRET_KEY",
	"AUTH_SHELL_ORIGIN",
] as const;
const MISSING_AUTH_EMAIL_CONFIG_KEYS = ["RESEND_API_KEY", "AUTH_EMAIL_FROM"] as const;

function readAppApiEnvironment(value: string | undefined): AppApiEnvironment | null {
	const environment = value?.trim();
	if (
		environment === "development" ||
		environment === "test" ||
		environment === "staging" ||
		environment === "production"
	) {
		return environment;
	}
	return null;
}

export function resolveAppName(): string {
	return APP_API_NAME;
}

export function resolveEnvironment(env: Env): AppApiEnvironment {
	const environment = readAppApiEnvironment(env.DEPLOYMENT_ENVIRONMENT);
	if (environment) {
		return environment;
	}
	throw new Error(
		`DEPLOYMENT_ENVIRONMENT must be one of development, test, staging, production; received ${JSON.stringify(env.DEPLOYMENT_ENVIRONMENT?.trim() ?? "")}.`,
	);
}

export function isDeployedEnvironment(environment: AppApiEnvironment | undefined): boolean {
	return environment === "production" || environment === "staging";
}

export function getMissingRuntimeConfig(env: Env): string[] {
	const missing: string[] = [];

	if (!env.APP_API_DB?.connectionString?.trim()) {
		missing.push(MISSING_CONFIG_KEYS[0]);
	}
	if (!readAppApiEnvironment(env.DEPLOYMENT_ENVIRONMENT)) {
		missing.push(MISSING_CONFIG_KEYS[1]);
	}
	if (!env.BETTER_AUTH_SECRET?.trim()) {
		missing.push(MISSING_CONFIG_KEYS[2]);
	}
	if (!env.AUTH_TURNSTILE_SECRET_KEY?.trim()) {
		missing.push(MISSING_CONFIG_KEYS[3]);
	}
	if (!env.AUTH_SHELL_ORIGIN?.trim()) {
		missing.push(MISSING_CONFIG_KEYS[4]);
	}
	if (!env.APP_API_SAFETY_IDENTIFIER_HMAC_SECRET?.trim()) {
		missing.push(MISSING_CONFIG_KEYS[5]);
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
	if (!env.AUTH_SHELL_ORIGIN?.trim()) {
		missing.push(MISSING_AUTH_CONFIG_KEYS[2]);
	}
	return missing;
}

export function getMissingAuthEmailConfig(env: Env): string[] {
	const missing: string[] = [];
	if (!env.RESEND_API_KEY?.trim()) {
		missing.push(MISSING_AUTH_EMAIL_CONFIG_KEYS[0]);
	}
	if (!env.AUTH_EMAIL_FROM?.trim()) {
		missing.push(MISSING_AUTH_EMAIL_CONFIG_KEYS[1]);
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
	};
}

export function readAppAuthEmailConfig(env: Env): AppAuthEmailConfig {
	const missing = getMissingAuthEmailConfig(env);
	if (missing.length > 0) {
		throw new Error(`Missing auth email configuration: ${missing.join(", ")}`);
	}

	return {
		resendApiKey: readRequiredTrimmedValue(env.RESEND_API_KEY, "RESEND_API_KEY"),
		authEmailFrom: readRequiredTrimmedValue(env.AUTH_EMAIL_FROM, "AUTH_EMAIL_FROM"),
		authEmailReplyTo: env.AUTH_EMAIL_REPLY_TO?.trim() || undefined,
	};
}
