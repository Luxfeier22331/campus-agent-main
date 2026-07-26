import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseEnv } from "node:util";

import type { LocalDevProfileV1 } from "./profile";

export const MANAGED_LOCAL_ENV_MARKER = "# Managed by pnpm dev:init. Do not edit.";

const LOCAL_DATABASE_PASSWORDS = {
	appApi: "campus-agent-local-app-api",
	opsWeb: "campus-agent-local-ops-web",
	owner: "campus-agent-local-owner",
} as const;
const LOCAL_ENVIRONMENT_PATHS = [
	"apps/app-api/.env.local",
	"apps/app-api/.dev.vars.local",
	"apps/campus-web/.dev.vars.local",
	"apps/ops-web/.env.local",
] as const;

export function localDatabaseUrls(profile: LocalDevProfileV1): {
	appApi: string;
	opsWeb: string;
	owner: string;
} {
	const url = (role: string, password: string) =>
		`postgresql://${role}:${encodeURIComponent(password)}@127.0.0.1:5432/${profile.databaseName}`;
	return {
		appApi: url("app_api", LOCAL_DATABASE_PASSWORDS.appApi),
		opsWeb: url("ops_web", LOCAL_DATABASE_PASSWORDS.opsWeb),
		owner: url("campus_agent", LOCAL_DATABASE_PASSWORDS.owner),
	};
}

export function renderLocalEnvironmentFiles(input: {
	profile: LocalDevProfileV1;
	repoRoot: string;
}): string[] {
	const { profile, repoRoot } = input;
	assertLocalEnvironmentFilesAreManaged(repoRoot);
	const database = localDatabaseUrls(profile);
	const appApiEnvPath = resolve(repoRoot, "apps/app-api/.env.local");
	const appApiVarsPath = resolve(repoRoot, "apps/app-api/.dev.vars.local");
	const campusVarsPath = resolve(repoRoot, "apps/campus-web/.dev.vars.local");
	const opsEnvPath = resolve(repoRoot, "apps/ops-web/.env.local");
	const existingSecrets = readManagedEnv(appApiVarsPath);
	const opsWebInternalToken = existingSecrets.OPS_WEB_INTERNAL_TOKEN || randomSecret();

	writeManagedEnv(appApiEnvPath, {
		APP_API_DATABASE_SSLMODE: "disable",
		APP_API_SCHEMA_DATABASE_URL: database.owner,
		CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB: database.appApi,
		CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB_FRESH: database.appApi,
	});
	writeManagedEnv(appApiVarsPath, {
		APP_API_ENVIRONMENT: "development",
		APP_API_EXECUTION_SHARED_SECRET:
			existingSecrets.APP_API_EXECUTION_SHARED_SECRET || randomSecret(),
		APP_API_SAFETY_IDENTIFIER_HMAC_SECRET:
			existingSecrets.APP_API_SAFETY_IDENTIFIER_HMAC_SECRET || randomSecret(),
		AUTH_SHELL_ORIGIN: `http://127.0.0.1:${profile.ports.campusWeb}`,
		AUTH_TURNSTILE_SECRET_KEY: "local-turnstile-disabled",
		BETTER_AUTH_SECRET: existingSecrets.BETTER_AUTH_SECRET || randomSecret(),
		OBJECT_STORE_LOCAL_BASE_URL: `http://127.0.0.1:9000/${profile.bucketName}/`,
		OPS_WEB_INTERNAL_TOKEN: opsWebInternalToken,
		RESEND_API_KEY: existingSecrets.RESEND_API_KEY || "local-resend-disabled",
		SENTRY_DSN: "",
		SENTRY_ENVIRONMENT: "development",
		SENTRY_RELEASE: `app-api@${profile.instanceId}`,
	});
	writeManagedEnv(campusVarsPath, {
		APP_API_BASE_URL: `http://127.0.0.1:${profile.ports.appApi}`,
		AUTH_TURNSTILE_APPEARANCE: "interaction-only",
		AUTH_TURNSTILE_EXECUTION: "render",
		AUTH_TURNSTILE_SITE_KEY: "",
		CAMPUS_WEB_HOSTNAME: `127.0.0.1:${profile.ports.campusWeb}`,
		SENTRY_BROWSER_DSN: "",
		SENTRY_DSN: "",
		SENTRY_ENVIRONMENT: "development",
		SENTRY_RELEASE: `campus-web@${profile.instanceId}`,
	});
	writeManagedEnv(opsEnvPath, {
		DEPLOYMENT_ENVIRONMENT: "local",
		NODE_ENV: "development",
		OPS_WEB_API_DEV_PORT: String(profile.ports.opsWebApi),
		OPS_WEB_APP_API_URL: `http://127.0.0.1:${profile.ports.appApi}`,
		OPS_WEB_CAMPUS_WEB_URL: `http://127.0.0.1:${profile.ports.campusWeb}`,
		OPS_WEB_DEV_PORT: String(profile.ports.opsWeb),
		OBJECT_STORE_BUCKET_DERIVED: profile.bucketName,
		OBJECT_STORE_DERIVED_ACCESS_KEY: "minioadmin",
		OBJECT_STORE_DERIVED_SECRET_KEY: "minioadmin",
		OBJECT_STORE_ENDPOINT: "http://127.0.0.1:9000",
		OPS_WEB_DATABASE_SSLMODE: "disable",
		OPS_WEB_DATABASE_URL: database.opsWeb,
		OPS_WEB_FIXTURE_MODE: "1",
		OPS_WEB_INTERNAL_TOKEN: opsWebInternalToken,
		OPS_WEB_PUBLIC_ORIGIN: `http://127.0.0.1:${profile.ports.opsWeb}`,
		PORT: String(profile.ports.opsWebApi),
	});
	return [appApiEnvPath, appApiVarsPath, campusVarsPath, opsEnvPath];
}

export function removeLocalEnvironmentFiles(repoRoot: string): void {
	assertLocalEnvironmentFilesAreManaged(repoRoot);
	for (const path of LOCAL_ENVIRONMENT_PATHS) {
		const resolved = resolve(repoRoot, path);
		if (!existsSync(resolved)) {
			continue;
		}
		assertManagedFile(resolved);
		rmSync(resolved, { force: true });
	}
}

export function assertLocalEnvironmentFilesAreManaged(repoRoot: string): void {
	for (const path of LOCAL_ENVIRONMENT_PATHS) {
		const resolved = resolve(repoRoot, path);
		if (existsSync(resolved)) {
			assertManagedFile(resolved);
		}
	}
}

function readManagedEnv(path: string): Record<string, string> {
	if (!existsSync(path)) {
		return {};
	}
	assertManagedFile(path);
	return parseEnv(readFileSync(path, "utf8"));
}

function writeManagedEnv(path: string, values: Record<string, string>): void {
	if (existsSync(path)) {
		assertManagedFile(path);
	}
	const body = [
		MANAGED_LOCAL_ENV_MARKER,
		...Object.entries(values)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, value]) => `${key}=${JSON.stringify(value)}`),
		"",
	].join("\n");
	const temporaryPath = resolve(dirname(path), `.${randomBytes(8).toString("hex")}.tmp`);
	writeFileSync(temporaryPath, body, { mode: 0o600 });
	renameSync(temporaryPath, path);
	chmodSync(path, 0o600);
}

function assertManagedFile(path: string): void {
	if (!readFileSync(path, "utf8").startsWith(MANAGED_LOCAL_ENV_MARKER)) {
		throw new Error(`Refusing to overwrite unmanaged local environment file: ${path}`);
	}
}

function randomSecret(): string {
	return randomBytes(32).toString("base64url");
}

export const LOCAL_DEV_DATABASE_PASSWORDS = LOCAL_DATABASE_PASSWORDS;
