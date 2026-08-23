import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { parseEnv } from "node:util";

import type { LocalDevProfileV1 } from "./profile";
import { calculateLocalDevRuntimePorts } from "./profile";

export const MANAGED_LOCAL_ENV_MARKER = "# Managed by pnpm dev:init. Do not edit.";
const LOCAL_MODEL_CONFIG_ENCRYPTION_KEY_PATH = "var/dev/model-config-encryption.key";
const LOCAL_LEGACY_PROVIDER_CONFIG_ENCRYPTION_KEY_PATH = "var/dev/provider-config-encryption.key";
const IMPORTED_EXTERNAL_ENV_MARKER =
	"# External development credentials imported from the main checkout by pnpm dev:init.";

const SHARED_EXTERNAL_PROVIDER_ENV_KEYS = [
	"LLM_BASE_URL",
	"LLM_API_KEY",
	"LLM_MODEL",
	"RAG_SYNTHESIS_MODEL",
	"EMBEDDING_BASE_URL",
	"EMBEDDING_API_KEY",
	"EMBEDDING_MODEL",
	"EMBEDDING_DIMENSIONS",
	"RERANK_BASE_URL",
	"RERANK_API_KEY",
	"RERANK_MODEL",
	"RERANK_PATH",
	"INTERNAL_NOTICE_CLASSIFIER_OPENAI_BASE_URL",
	"INTERNAL_NOTICE_CLASSIFIER_OPENAI_API_KEY",
	"INTERNAL_NOTICE_CLASSIFIER_OPENAI_MODEL",
] as const;

const MAIN_INTERNAL_PORTAL_ENV_PATHS = [
	"jobs/internal-portal-collection/adapters/internal-portal/.env.local",
	"apps/source-collector/adapters/internal-portal/.env.local",
] as const;

export const MANAGED_LOCAL_ENVIRONMENT_PATHS = {
	appApi: "apps/app-api/.env.local",
	appApiVars: "apps/app-api/.dev.vars.local",
	campusWeb: "apps/campus-web/.dev.vars.local",
	executionControl: "apps/execution-control/.env.local",
	modelConfig: "apps/model-config/.env.local",
	agentRuntime: "apps/agent-runtime/.env.local",
	ingestionControl: "apps/ingestion-control/.env.local",
	noticeClassifier: "jobs/notice-classifier/.env.local",
	noticePublisher: "jobs/notice-publisher/.env.local",
	opsWeb: "apps/ops-web/.env.local",
	internalPortalCollection: "jobs/internal-portal-collection/adapters/internal-portal/.env.local",
} as const;

type ManagedLocalEnvironment = keyof typeof MANAGED_LOCAL_ENVIRONMENT_PATHS;

interface MainCheckoutExternalCredentials {
	internalPortalSsoTgc?: string;
	provider: Record<string, string>;
}

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
	core: ["appApi", "appApiVars", "campusWeb", "modelConfig", "executionControl", "agentRuntime"],
	"ops-web": ["opsWeb"],
	"ingestion-control": ["ingestionControl"],
	"notice-publisher": ["noticePublisher"],
	"internal-portal-collection": ["internalPortalCollection"],
	"notice-classifier": ["noticeClassifier"],
};

const LOCAL_DATABASE_PASSWORDS = {
	appApi: "campus-agent-local-app-api",
	executionControl: "campus-agent-local-execution-control",
	modelConfig: "campus-agent-local-model-config",
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

export function resolveMainCheckoutRoot(repoRoot: string): string {
	const commonDirectory = realpathSync(
		resolve(
			repoRoot,
			execFileSync("git", ["rev-parse", "--git-common-dir"], {
				cwd: repoRoot,
				encoding: "utf8",
			}).trim(),
		),
	);
	return realpathSync(dirname(commonDirectory));
}

export function importMainCheckoutExternalCredentials(input: {
	mainCheckoutRoot: string;
	repoRoot: string;
}): void {
	if (realpathSync(input.mainCheckoutRoot) === realpathSync(input.repoRoot)) {
		return;
	}
	const credentials = readMainCheckoutExternalCredentials(input.mainCheckoutRoot);
	appendMissingEnvValues(resolve(input.repoRoot, ".env"), credentials.provider);
	if (!credentials.internalPortalSsoTgc) {
		return;
	}
	const path = managedLocalEnvironmentPaths(input.repoRoot).internalPortalCollection;
	const existing = readManagedEnv(path);
	if (Object.hasOwn(existing, "INTERNAL_PORTAL_SSO_TGC")) {
		return;
	}
	writeManagedEnv(path, {
		...existing,
		INTERNAL_PORTAL_SSO_TGC: credentials.internalPortalSsoTgc,
	});
}

export function localDatabaseUrls(profile: LocalDevProfileV1): {
	appApi: string;
	executionControl: string;
	modelConfig: string;
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
		modelConfig: url("model_config", LOCAL_DATABASE_PASSWORDS.modelConfig),
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
			MODEL_CONFIG_URL: `http://127.0.0.1:${runtimePorts.modelConfig}`,
			EXECUTION_CONTROL_PRODUCT_CALLBACK_BASE_URL: `http://127.0.0.1:${profile.ports.appApi}`,
			EXECUTION_CONTROL_TEMPORAL_ADDRESS: "127.0.0.1:7233",
			EXECUTION_CONTROL_TEMPORAL_NAMESPACE: `campus-agent-local-${profile.instanceId}`,
			EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY: `${profile.instanceId}:execution-control`,
			HOST: "127.0.0.1",
			PORT: String(runtimePorts.executionControl),
		});
	}
	if (shouldRender("modelConfig")) {
		writeManagedEnv(paths.modelConfig, {
			MODEL_CONFIG_DATABASE_URL: database.modelConfig,
			MODEL_CONFIG_ENCRYPTION_KEY_FILE: resolveLocalModelConfigEncryptionKeyPath(repoRoot),
			MODEL_CONFIG_HOST: "127.0.0.1",
			MODEL_CONFIG_PORT: String(runtimePorts.modelConfig),
		});
	}
	if (shouldRender("agentRuntime")) {
		writeManagedEnv(paths.agentRuntime, {
			AGENT_RUNTIME_EXECUTION_CONTROL_BASE_URL: `http://127.0.0.1:${runtimePorts.executionControl}`,
			DEPLOYMENT_ENVIRONMENT: "development",
			DEPLOYMENT_RELEASE: `execution-runtime@${profile.instanceId}`,
			EXECUTION_AGENT_RUNTIME_SHARED_SECRET: executionSharedSecret,
			HOST: "127.0.0.1",
			MODEL_CONFIG_URL: `http://127.0.0.1:${runtimePorts.modelConfig}`,
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
			MODEL_CONFIG_URL: `http://127.0.0.1:${runtimePorts.modelConfig}`,
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
			MODEL_CONFIG_URL: `http://127.0.0.1:${runtimePorts.modelConfig}`,
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

export function resolveLocalModelConfigEncryptionKeyPath(repoRoot: string): string {
	return resolve(repoRoot, LOCAL_MODEL_CONFIG_ENCRYPTION_KEY_PATH);
}

export function resolveLocalLegacyProviderConfigEncryptionKeyPath(repoRoot: string): string {
	return resolve(repoRoot, LOCAL_LEGACY_PROVIDER_CONFIG_ENCRYPTION_KEY_PATH);
}

export function ensureLocalModelConfigEncryptionKey(repoRoot: string): string {
	return ensurePrivateEncryptionKey(resolveLocalModelConfigEncryptionKeyPath(repoRoot));
}

export function ensureLocalLegacyProviderConfigEncryptionKey(repoRoot: string): string {
	return ensurePrivateEncryptionKey(resolveLocalLegacyProviderConfigEncryptionKeyPath(repoRoot));
}

function ensurePrivateEncryptionKey(path: string): string {
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

function readMainCheckoutExternalCredentials(
	mainCheckoutRoot: string,
): MainCheckoutExternalCredentials {
	const rootEnvironment = readOptionalEnv(resolve(mainCheckoutRoot, ".env"));
	const provider = Object.fromEntries(
		SHARED_EXTERNAL_PROVIDER_ENV_KEYS.flatMap((key) => {
			const value = rootEnvironment[key]?.trim();
			return value ? [[key, value]] : [];
		}),
	);
	const internalPortalSsoTgc = MAIN_INTERNAL_PORTAL_ENV_PATHS.map((relativePath) =>
		readOptionalEnv(resolve(mainCheckoutRoot, relativePath)).INTERNAL_PORTAL_SSO_TGC?.trim(),
	).find(Boolean);
	return {
		...(internalPortalSsoTgc ? { internalPortalSsoTgc } : {}),
		provider,
	};
}

function readOptionalEnv(path: string): Record<string, string> {
	return existsSync(path) ? parseEnv(readFileSync(path, "utf8")) : {};
}

function appendMissingEnvValues(path: string, values: Record<string, string>): void {
	const current = existsSync(path) ? readFileSync(path, "utf8") : "";
	const parsed = current ? parseEnv(current) : {};
	const missing = Object.entries(values).filter(([key]) => !Object.hasOwn(parsed, key));
	if (missing.length === 0) {
		return;
	}
	const prefix = current.trimEnd();
	const body = [
		...(prefix ? [prefix] : [IMPORTED_EXTERNAL_ENV_MARKER]),
		...missing
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, value]) => `${key}=${JSON.stringify(value)}`),
		"",
	].join("\n");
	writePrivateFileAtomic(path, body);
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
	writePrivateFileAtomic(path, body);
}

function writePrivateFileAtomic(path: string, body: string): void {
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
