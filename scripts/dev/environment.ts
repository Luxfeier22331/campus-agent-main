import { randomBytes } from "node:crypto";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { parseEnv } from "node:util";

import type { LocalDevProfileV1 } from "./profile";
import { calculateLocalDevRuntimePorts } from "./profile";

export const MANAGED_LOCAL_ENV_MARKER = "# Managed by pnpm dev:init. Do not edit.";
const LOCAL_PROVIDER_CONFIG_ENCRYPTION_KEY_PATH = "var/dev/provider-config-encryption.key";

export const MANAGED_LOCAL_ENVIRONMENT_PATHS = {
	appApi: "apps/app-api/.env.local",
	appApiVars: "apps/app-api/.dev.vars.local",
	campusWeb: "apps/campus-web/.dev.vars.local",
	executionControl: "apps/execution-control/.env.local",
	agentRuntime: "apps/agent-runtime/.env.local",
	ingestionControl: "apps/ingestion-control/.env.local",
	noticeClassifier: "jobs/notice-classifier/.env.local",
	noticePublisher: "jobs/notice-publisher/.env.local",
	opsWeb: "apps/ops-web/.env.local",
	internalPortalCollection: "jobs/internal-portal-collection/adapters/internal-portal/.env.local",
} as const;

type ManagedLocalEnvironment = keyof typeof MANAGED_LOCAL_ENVIRONMENT_PATHS;

export type LocalDevEnvironmentTarget =
	| "core"
	| "ops-web"
	| "ingestion-control"
	| "notice-publisher"
	| "internal-portal-collection"
	| "notice-classifier"
	| "all";

const LOCAL_DEV_ENVIRONMENT_TARGETS: Record<
	Exclude<LocalDevEnvironmentTarget, "all">,
	readonly ManagedLocalEnvironment[]
> = {
	core: ["appApi", "appApiVars", "campusWeb", "executionControl", "agentRuntime"],
	"ops-web": ["opsWeb"],
	"ingestion-control": ["ingestionControl"],
	"notice-publisher": ["noticePublisher"],
	"internal-portal-collection": ["internalPortalCollection"],
	"notice-classifier": ["noticeClassifier"],
};

const LOCAL_DATABASE_PASSWORDS = {
	appApi: "campus-agent-local-app-api",
	executionControl: "campus-agent-local-execution-control",
	ingestionControl: "campus-agent-local-ingestion-control",
	opsWeb: "campus-agent-local-ops-web",
	noticePublisher: "campus-agent-local-notice-publisher",
	owner: "campus-agent-local-owner",
} as const;

export function managedLocalEnvironmentPaths(
	repoRoot: string,
): Record<ManagedLocalEnvironment, string> {
	return Object.fromEntries(
		Object.entries(MANAGED_LOCAL_ENVIRONMENT_PATHS).map(([name, path]) => [
			name,
			resolve(repoRoot, path),
		]),
	) as Record<ManagedLocalEnvironment, string>;
}

export function managedLocalEnvironmentPathsForTarget(
	repoRoot: string,
	target: LocalDevEnvironmentTarget,
): string[] {
	const paths = managedLocalEnvironmentPaths(repoRoot);
	const names =
		target === "all"
			? (Object.keys(paths) as ManagedLocalEnvironment[])
			: LOCAL_DEV_ENVIRONMENT_TARGETS[target];
	return names.map((name) => paths[name]);
}

export function localDatabaseUrls(profile: LocalDevProfileV1): {
	appApi: string;
	executionControl: string;
	ingestionControl: string;
	opsWeb: string;
	noticePublisher: string;
	owner: string;
} {
	const url = (role: string, password: string) =>
		`postgresql://${role}:${encodeURIComponent(password)}@127.0.0.1:5432/${profile.databaseName}`;
	return {
		appApi: url("app_api", LOCAL_DATABASE_PASSWORDS.appApi),
		executionControl: url("execution_control", LOCAL_DATABASE_PASSWORDS.executionControl),
		ingestionControl: url("ingestion_control", LOCAL_DATABASE_PASSWORDS.ingestionControl),
		opsWeb: url("ops_web", LOCAL_DATABASE_PASSWORDS.opsWeb),
		noticePublisher: url("notice_publisher", LOCAL_DATABASE_PASSWORDS.noticePublisher),
		owner: url("campus_agent", LOCAL_DATABASE_PASSWORDS.owner),
	};
}

export function renderLocalEnvironmentFiles(input: {
	profile: LocalDevProfileV1;
	repoRoot: string;
	target?: LocalDevEnvironmentTarget;
}): string[] {
	const { profile, repoRoot } = input;
	const target = input.target ?? "all";
	assertLocalEnvironmentFilesAreManaged(repoRoot, target);
	const database = localDatabaseUrls(profile);
	const paths = managedLocalEnvironmentPaths(repoRoot);
	const runtimePorts = calculateLocalDevRuntimePorts(profile.slot);
	const existingSecrets = readManagedEnv(paths.appApiVars);
	const executionControlEnvironment = readManagedEnv(paths.executionControl);
	const opsWebEnvironment = readManagedEnv(paths.opsWeb);
	const existingInternalPortalCollectionEnvironment = readManagedEnv(
		paths.internalPortalCollection,
	);
	const executionSharedSecret =
		existingSecrets.APP_API_EXECUTION_SHARED_SECRET ||
		executionControlEnvironment.EXECUTION_AGENT_RUNTIME_SHARED_SECRET ||
		randomSecret();
	const opsWebInternalToken =
		existingSecrets.OPS_WEB_INTERNAL_TOKEN ||
		executionControlEnvironment.OPS_WEB_INTERNAL_TOKEN ||
		opsWebEnvironment.OPS_WEB_INTERNAL_TOKEN ||
		randomSecret();
	const shouldRender = (name: ManagedLocalEnvironment): boolean =>
		target === "all" ||
		(LOCAL_DEV_ENVIRONMENT_TARGETS[target] as readonly ManagedLocalEnvironment[]).includes(name);

	if (shouldRender("appApi")) {
		writeManagedEnv(paths.appApi, {
			APP_API_SCHEMA_DATABASE_SSLMODE: "disable",
			APP_API_SCHEMA_DATABASE_URL: database.owner,
			CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB: database.appApi,
			PORT: String(profile.ports.appApi),
		});
	}
	if (shouldRender("appApiVars")) {
		writeManagedEnv(paths.appApiVars, {
			APP_API_EXECUTION_SHARED_SECRET: executionSharedSecret,
			APP_API_SAFETY_IDENTIFIER_HMAC_SECRET:
				existingSecrets.APP_API_SAFETY_IDENTIFIER_HMAC_SECRET || randomSecret(),
			AUTH_SHELL_ORIGIN: `http://127.0.0.1:${profile.ports.campusWeb}`,
			AUTH_TURNSTILE_SECRET_KEY: "local-turnstile-disabled",
			BETTER_AUTH_SECRET: existingSecrets.BETTER_AUTH_SECRET || randomSecret(),
			EXECUTION_CONTROL_BASE_URL: `http://127.0.0.1:${runtimePorts.executionControl}`,
			OBJECT_STORE_DERIVED_READ_ACCESS_KEY: "minioadmin",
			OBJECT_STORE_DERIVED_READ_SECRET_KEY: "minioadmin",
			OBJECT_STORE_LOCAL_BASE_URL: `http://127.0.0.1:9000/${profile.bucketName}/`,
			OPS_WEB_INTERNAL_TOKEN: opsWebInternalToken,
			RESEND_API_KEY: existingSecrets.RESEND_API_KEY || "local-resend-disabled",
			SENTRY_DSN: "",
			DEPLOYMENT_ENVIRONMENT: "development",
			DEPLOYMENT_RELEASE: `app-api@${profile.instanceId}`,
		});
	}
	if (shouldRender("campusWeb")) {
		writeManagedEnv(paths.campusWeb, {
			APP_API_BASE_URL: `http://127.0.0.1:${profile.ports.appApi}`,
			AUTH_TURNSTILE_SITE_KEY: "",
			CAMPUS_WEB_DEV_PORT: String(profile.ports.campusWeb),
			OBJECT_STORE_DERIVED_READ_ACCESS_KEY: "minioadmin",
			OBJECT_STORE_DERIVED_READ_SECRET_KEY: "minioadmin",
			OBJECT_STORE_ENDPOINT: "http://127.0.0.1:9000",
			SENTRY_DSN: "",
			DEPLOYMENT_ENVIRONMENT: "development",
			DEPLOYMENT_RELEASE: `campus-web@${profile.instanceId}`,
		});
	}
	if (shouldRender("executionControl")) {
		writeManagedEnv(paths.executionControl, {
			APP_API_EXECUTION_SHARED_SECRET: executionSharedSecret,
			DEPLOYMENT_ENVIRONMENT: "development",
			DEPLOYMENT_RELEASE: `execution-runtime@${profile.instanceId}`,
			EXECUTION_AGENT_RUNTIME_SHARED_SECRET: executionSharedSecret,
			EXECUTION_CONTROL_AGENT_RUNTIME_BASE_URL: `http://127.0.0.1:${runtimePorts.agentRuntime}`,
			EXECUTION_CONTROL_DATABASE_URL: database.executionControl,
			EXECUTION_CONTROL_PRODUCT_CALLBACK_BASE_URL: `http://127.0.0.1:${profile.ports.appApi}`,
			EXECUTION_CONTROL_TEMPORAL_ADDRESS: "127.0.0.1:7233",
			EXECUTION_CONTROL_TEMPORAL_NAMESPACE: `campus-agent-local-${profile.instanceId}`,
			EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY: `${profile.instanceId}:execution-control`,
			HOST: "127.0.0.1",
			OPS_WEB_INTERNAL_TOKEN: opsWebInternalToken,
			PORT: String(runtimePorts.executionControl),
			PROVIDER_CONFIG_ENCRYPTION_KEY_FILE: resolveLocalProviderConfigEncryptionKeyPath(repoRoot),
		});
	}
	if (shouldRender("agentRuntime")) {
		writeManagedEnv(paths.agentRuntime, {
			AGENT_RUNTIME_EXECUTION_CONTROL_BASE_URL: `http://127.0.0.1:${runtimePorts.executionControl}`,
			DEPLOYMENT_ENVIRONMENT: "development",
			DEPLOYMENT_RELEASE: `execution-runtime@${profile.instanceId}`,
			EXECUTION_AGENT_RUNTIME_SHARED_SECRET: executionSharedSecret,
			HOST: "127.0.0.1",
			PORT: String(runtimePorts.agentRuntime),
		});
	}
	if (shouldRender("ingestionControl")) {
		writeManagedEnv(paths.ingestionControl, {
			DEPLOYMENT_ENVIRONMENT: "local",
			INGESTION_CONTROL_DATABASE_SSLMODE: "disable",
			INGESTION_CONTROL_DATABASE_URL: database.ingestionControl,
			INGESTION_CONTROL_SCHEMA_DATABASE_SSLMODE: "disable",
			INGESTION_CONTROL_SCHEMA_DATABASE_URL: database.owner,
			OPS_WEB_INTERNAL_TOKEN: opsWebInternalToken,
		});
	}
	if (shouldRender("opsWeb")) {
		writeManagedEnv(paths.opsWeb, {
			DEPLOYMENT_ENVIRONMENT: "local",
			NODE_ENV: "development",
			OPS_WEB_APP_API_URL: `http://127.0.0.1:${profile.ports.appApi}`,
			OPS_WEB_CAMPUS_WEB_URL: `http://127.0.0.1:${profile.ports.campusWeb}`,
			OBJECT_STORE_BUCKET_DERIVED: profile.bucketName,
			OBJECT_STORE_DERIVED_ACCESS_KEY: "minioadmin",
			OBJECT_STORE_DERIVED_SECRET_KEY: "minioadmin",
			OBJECT_STORE_DERIVED_READ_ACCESS_KEY: "minioadmin",
			OBJECT_STORE_DERIVED_READ_SECRET_KEY: "minioadmin",
			OBJECT_STORE_ENDPOINT: "http://127.0.0.1:9000",
			INGESTION_CONTROL_INTERNAL_URL: `http://127.0.0.1:${runtimePorts.ingestionControl}`,
			OPS_WEB_DATABASE_SSLMODE: "disable",
			OPS_WEB_DATABASE_URL: database.opsWeb,
			OPS_WEB_EXECUTION_CONTROL_ADMIN_URL: `http://127.0.0.1:${runtimePorts.executionControlAdmin}`,
			OPS_WEB_INTERNAL_TOKEN: opsWebInternalToken,
			OPS_WEB_AUTOMATION_ORIGIN: `http://127.0.0.1:${profile.ports.opsWebApi}`,
			OPS_WEB_PUBLIC_ORIGIN: `http://127.0.0.1:${profile.ports.opsWeb}`,
			OPS_WEB_WEB_PORT: String(profile.ports.opsWeb),
			PORT: String(profile.ports.opsWebApi),
		});
	}
	if (shouldRender("internalPortalCollection")) {
		writeManagedEnv(paths.internalPortalCollection, {
			...(existingInternalPortalCollectionEnvironment.INTERNAL_PORTAL_SSO_TGC
				? {
						INTERNAL_PORTAL_SSO_TGC:
							existingInternalPortalCollectionEnvironment.INTERNAL_PORTAL_SSO_TGC,
					}
				: {}),
			INGESTION_CONTROL_INTERNAL_URL: `http://127.0.0.1:${runtimePorts.ingestionControl}`,
			OBJECT_STORE_BUCKET_SOURCE: "campus-agent-source",
			OBJECT_STORE_ENDPOINT: "http://127.0.0.1:9000",
			OBJECT_STORE_REGION: "us-east-1",
			OBJECT_STORE_SOURCE_ACCESS_KEY: "minioadmin",
			OBJECT_STORE_SOURCE_SECRET_KEY: "minioadmin",
			OPS_WEB_INTERNAL_TOKEN: opsWebInternalToken,
		});
	}
	if (shouldRender("noticeClassifier")) {
		writeManagedEnv(paths.noticeClassifier, {
			OBJECT_STORE_BUCKET_DERIVED: profile.bucketName,
			OBJECT_STORE_BUCKET_SOURCE: "campus-agent-source",
			OBJECT_STORE_DERIVED_ACCESS_KEY: "minioadmin",
			OBJECT_STORE_DERIVED_SECRET_KEY: "minioadmin",
			OBJECT_STORE_ENDPOINT: "http://127.0.0.1:9000",
			OBJECT_STORE_REGION: "us-east-1",
			OBJECT_STORE_SOURCE_ACCESS_KEY: "minioadmin",
			OBJECT_STORE_SOURCE_SECRET_KEY: "minioadmin",
		});
	}
	if (shouldRender("noticePublisher")) {
		writeManagedEnv(paths.noticePublisher, {
			DEPLOYMENT_ENVIRONMENT: "local",
			NOTICES_DATABASE_SSLMODE: "disable",
			NOTICES_DATABASE_URL: database.noticePublisher,
			OBJECT_STORE_BUCKET_DERIVED: profile.bucketName,
			OBJECT_STORE_BUCKET_SOURCE: "campus-agent-source",
			OBJECT_STORE_DERIVED_ACCESS_KEY: "minioadmin",
			OBJECT_STORE_DERIVED_SECRET_KEY: "minioadmin",
			OBJECT_STORE_ENDPOINT: "http://127.0.0.1:9000",
			OBJECT_STORE_SOURCE_ACCESS_KEY: "minioadmin",
			OBJECT_STORE_SOURCE_SECRET_KEY: "minioadmin",
		});
	}
	return managedLocalEnvironmentPathsForTarget(repoRoot, target);
}

export function resolveLocalProviderConfigEncryptionKeyPath(repoRoot: string): string {
	return resolve(repoRoot, LOCAL_PROVIDER_CONFIG_ENCRYPTION_KEY_PATH);
}

export function ensureLocalProviderConfigEncryptionKey(repoRoot: string): string {
	const path = resolveLocalProviderConfigEncryptionKeyPath(repoRoot);
	if (existsSync(path)) {
		return path;
	}
	mkdirSync(dirname(path), { recursive: true });
	const body = `${randomBytes(32).toString("base64")}\n`;
	const temporaryPath = resolve(dirname(path), `.${randomBytes(8).toString("hex")}.tmp`);
	writeFileSync(temporaryPath, body, { mode: 0o600 });
	renameSync(temporaryPath, path);
	chmodSync(path, 0o600);
	return path;
}

export function removeLocalEnvironmentFiles(repoRoot: string): void {
	assertLocalEnvironmentFilesAreManaged(repoRoot);
	for (const resolved of Object.values(managedLocalEnvironmentPaths(repoRoot))) {
		if (!existsSync(resolved)) {
			continue;
		}
		assertManagedFile(resolved);
		rmSync(resolved, { force: true });
	}
}

export function assertLocalEnvironmentFilesAreManaged(
	repoRoot: string,
	target: LocalDevEnvironmentTarget = "all",
): void {
	for (const resolved of managedLocalEnvironmentPathsForTarget(repoRoot, target)) {
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
