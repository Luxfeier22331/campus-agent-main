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
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { parseEnv } from "node:util";

import type { LocalQdrantConnection } from "./local-qdrant";
import { ensureLocalDevSecrets } from "./local-secrets";
import type { LocalDevProfileV2 } from "./profile";
import { calculateLocalDevRuntimePorts } from "./profile";
import {
	type LocalDevEnvironmentProjection,
	type LocalDevTarget,
	type LocalModelConfigName,
	resolveLocalDevTargetPlan,
} from "./targets";

export const MANAGED_LOCAL_ENV_MARKER = "# Managed by pnpm dev:init. Do not edit.";
const LOCAL_MODEL_CONFIG_ENCRYPTION_KEY_PATH = "var/dev/model-config-encryption.key";
const IMPORTED_EXTERNAL_ENV_MARKER =
	"# External development credentials imported from the main checkout by pnpm dev:init.";

const SHARED_EXTERNAL_PROVIDER_ENV_KEYS = [
	"DOCUMENT_OCR_API_KEY",
	"DOCUMENT_OCR_BASE_URL",
	"LLM_BASE_URL",
	"LLM_API_KEY",
	"LLM_MODEL",
	"LLM_PROVIDER",
	"LLM_API_PROTOCOL",
	"NOTICE_CLASSIFICATION_BASE_URL",
	"NOTICE_CLASSIFICATION_API_KEY",
	"NOTICE_CLASSIFICATION_MODEL",
	"NOTICE_CLASSIFICATION_PROVIDER",
	"NOTICE_CLASSIFICATION_API_PROTOCOL",
	"EMBEDDING_BASE_URL",
	"EMBEDDING_API_KEY",
	"RERANK_BASE_URL",
	"RERANK_API_KEY",
	"RERANK_MODEL",
] as const;

const LOCAL_MODEL_CONFIG_ENVIRONMENT_KEYS: Record<LocalModelConfigName, readonly string[]> = {
	document_ocr: ["DOCUMENT_OCR_BASE_URL", "DOCUMENT_OCR_API_KEY"],
	primary_agent: ["LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL", "LLM_PROVIDER", "LLM_API_PROTOCOL"],
	campus_docs_embedding: ["EMBEDDING_BASE_URL", "EMBEDDING_API_KEY"],
	campus_docs_reranker: ["RERANK_BASE_URL", "RERANK_API_KEY", "RERANK_MODEL"],
	notice_classification: [
		"NOTICE_CLASSIFICATION_BASE_URL",
		"NOTICE_CLASSIFICATION_API_KEY",
		"NOTICE_CLASSIFICATION_MODEL",
		"NOTICE_CLASSIFICATION_PROVIDER",
		"NOTICE_CLASSIFICATION_API_PROTOCOL",
	],
};

const MAIN_INTERNAL_PORTAL_ENV_PATH =
	"jobs/internal-portal-collection/adapters/internal-portal/.env.local";

export const MANAGED_LOCAL_ENVIRONMENT_PATHS = {
	documentOcr: "jobs/document-ocr/.env.local",
	appApi: "apps/app-api/.env.local",
	appApiVars: "apps/app-api/.dev.vars.local",
	campusWeb: "apps/campus-web/.dev.vars.local",
	executionControl: "apps/execution-control/.env.local",
	modelConfig: "apps/model-config/.env.local",
	agentRuntime: "apps/agent-runtime/.env.local",
	noticeClassifier: "jobs/notice-classifier/.env.local",
	noticePublisher: "jobs/notice-publisher/.env.local",
	opsWeb: "apps/ops-web/.env.local",
	internalPortalCollection: "jobs/internal-portal-collection/adapters/internal-portal/.env.local",
	campusDocsIndexPublisher: "jobs/campus-docs-index-publisher/.env.local",
	campusRagIndexPublisher: "jobs/campus-rag-index-publisher/.env.local",
	noticeIndexPublisher: "jobs/notice-index-publisher/.env.local",
} as const;

type ManagedLocalEnvironment = keyof typeof MANAGED_LOCAL_ENVIRONMENT_PATHS;

interface MainCheckoutExternalCredentials {
	internalPortalSsoTgc?: string;
	provider: Record<string, string>;
}

export type LocalDevEnvironmentTarget = LocalDevEnvironmentProjection;

const LOCAL_DEV_ENVIRONMENT_TARGETS: Record<
	LocalDevEnvironmentTarget,
	readonly ManagedLocalEnvironment[]
> = {
	"document-ocr": ["documentOcr"],
	core: ["appApi", "appApiVars", "campusWeb", "modelConfig", "executionControl", "agentRuntime"],
	"model-config": ["modelConfig"],
	"ops-web": ["opsWeb"],
	"notice-publisher": ["noticePublisher"],
	"internal-portal-collection": ["internalPortalCollection"],
	"notice-classifier": ["noticeClassifier"],
	"campus-docs-index-publisher": ["campusDocsIndexPublisher"],
	"campus-rag-index-publisher": ["campusRagIndexPublisher"],
	"notice-index-publisher": ["noticeIndexPublisher"],
};

const LOCAL_DATABASE_PASSWORDS = {
	appApi: "campus-agent-local-app-api",
	executionControl: "campus-agent-local-execution-control",
	modelConfig: "campus-agent-local-model-config",
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
	const names = LOCAL_DEV_ENVIRONMENT_TARGETS[target];
	return names.map((name) => paths[name]);
}

export function managedLocalEnvironmentPathsForProjections(
	repoRoot: string,
	projections: readonly LocalDevEnvironmentProjection[],
): string[] {
	return [
		...new Set(
			projections.flatMap((target) => managedLocalEnvironmentPathsForTarget(repoRoot, target)),
		),
	];
}

export function allManagedLocalEnvironmentPaths(repoRoot: string): string[] {
	return Object.values(managedLocalEnvironmentPaths(repoRoot));
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
	projections: readonly LocalDevEnvironmentProjection[];
	repoRoot: string;
}): void {
	if (realpathSync(input.mainCheckoutRoot) === realpathSync(input.repoRoot)) {
		return;
	}
	const credentials = readMainCheckoutExternalCredentials(input.mainCheckoutRoot);
	if (
		input.projections.some((projection) =>
			["core", "model-config", "campus-docs-index-publisher", "notice-index-publisher"].includes(
				projection,
			),
		)
	) {
		appendMissingEnvValues(resolve(input.repoRoot, ".env"), credentials.provider);
	}
	if (
		!(input.projections.includes("internal-portal-collection") && credentials.internalPortalSsoTgc)
	) {
		return;
	}
	const path = managedLocalEnvironmentPaths(input.repoRoot).internalPortalCollection;
	if (existsSync(path) && !isManagedFile(path)) {
		return;
	}
	const existing = readManagedEnv(path);
	if (Object.hasOwn(existing, "INTERNAL_PORTAL_SSO_TGC")) {
		return;
	}
	writeManagedEnv(path, {
		...existing,
		INTERNAL_PORTAL_SSO_TGC: credentials.internalPortalSsoTgc,
	});
}

export function localDatabaseUrls(profile: LocalDevProfileV2): {
	appApi: string;
	executionControl: string;
	modelConfig: string;
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
		opsWeb: url("ops_web", LOCAL_DATABASE_PASSWORDS.opsWeb),
		noticePublisher: url("notice_publisher", LOCAL_DATABASE_PASSWORDS.noticePublisher),
		owner: url("campus_agent", LOCAL_DATABASE_PASSWORDS.owner),
	};
}

export function localModelConfigEnvironment(input: {
	environment?: NodeJS.ProcessEnv;
	names: readonly LocalModelConfigName[];
	repoRoot: string;
}): Record<string, string> {
	const currentEnvironment = input.environment ?? process.env;
	const rootEnvironment = readOptionalEnv(resolve(input.repoRoot, ".env"));
	const keys = [
		...new Set(input.names.flatMap((name) => LOCAL_MODEL_CONFIG_ENVIRONMENT_KEYS[name])),
	];
	return Object.fromEntries(
		keys.flatMap((key) => {
			const value = currentEnvironment[key]?.trim() || rootEnvironment[key]?.trim();
			return value ? [[key, value]] : [];
		}),
	);
}

export function localModelConfigCommandEnvironment(input: {
	environment?: NodeJS.ProcessEnv;
	names: readonly LocalModelConfigName[];
	profile: LocalDevProfileV2;
	repoRoot: string;
}): NodeJS.ProcessEnv {
	const inheritedEnvironment = { ...(input.environment ?? process.env) };
	for (const key of SHARED_EXTERNAL_PROVIDER_ENV_KEYS) {
		delete inheritedEnvironment[key];
	}
	return {
		...inheritedEnvironment,
		...localModelConfigEnvironment({
			environment: input.environment,
			names: input.names,
			repoRoot: input.repoRoot,
		}),
		MODEL_CONFIG_DATABASE_URL: localDatabaseUrls(input.profile).modelConfig,
		MODEL_CONFIG_ENCRYPTION_KEY_FILE: resolveLocalModelConfigEncryptionKeyPath(input.repoRoot),
	};
}

function localNoProxyEnvironment(
	repoRoot: string,
	inherited: NodeJS.ProcessEnv,
): Record<string, string> {
	const local = readOptionalEnv(resolve(repoRoot, ".env"));
	const entries = (values: (string | undefined)[]) =>
		values.flatMap((value) =>
			(value ?? "")
				.split(",")
				.map((item) => item.trim())
				.filter(Boolean),
		);
	const additions = entries([local.NO_PROXY, local.no_proxy]);
	if (additions.length === 0) {
		return {};
	}
	const merged = [
		...new Set([...entries([inherited.NO_PROXY, inherited.no_proxy]), ...additions]),
	].join(",");
	return { NO_PROXY: merged, no_proxy: merged };
}

export function renderLocalEnvironmentFiles(input: {
	environment?: NodeJS.ProcessEnv;
	profile: LocalDevProfileV2;
	qdrant?: LocalQdrantConnection;
	repoRoot: string;
	target?: LocalDevTarget;
	projections?: readonly LocalDevEnvironmentProjection[];
}): string[] {
	const { profile, repoRoot } = input;
	const projections =
		input.projections ??
		(input.target
			? resolveLocalDevTargetPlan(input.target).environmentProjections
			: (Object.keys(LOCAL_DEV_ENVIRONMENT_TARGETS) as LocalDevEnvironmentProjection[]));
	const selectedPaths = managedLocalEnvironmentPathsForProjections(repoRoot, projections);
	assertLocalEnvironmentFilesAreManaged(repoRoot, projections);
	const database = localDatabaseUrls(profile);
	const paths = managedLocalEnvironmentPaths(repoRoot);
	const noProxy = localNoProxyEnvironment(repoRoot, input.environment ?? process.env);
	const runtimePorts = calculateLocalDevRuntimePorts(profile.slot);
	const rendersCore = projections.includes("core");
	const rendersOpsWeb = projections.includes("ops-web");
	const rendersInternalPortalCollection = projections.includes("internal-portal-collection");
	const existingSecrets = rendersCore ? readManagedEnv(paths.appApiVars) : {};
	const executionControlEnvironment = rendersCore ? readManagedEnv(paths.executionControl) : {};
	const opsWebEnvironment = rendersOpsWeb ? readManagedEnv(paths.opsWeb) : {};
	const existingInternalPortalCollectionEnvironment = rendersInternalPortalCollection
		? readManagedEnv(paths.internalPortalCollection)
		: {};
	const localSecrets =
		rendersCore || rendersOpsWeb || rendersInternalPortalCollection
			? ensureLocalDevSecrets(repoRoot, {
					appApiSafetyIdentifierHmacSecret: [existingSecrets.APP_API_SAFETY_IDENTIFIER_HMAC_SECRET],
					betterAuthSecret: [existingSecrets.BETTER_AUTH_SECRET],
					executionSharedSecret: [
						existingSecrets.APP_API_EXECUTION_SHARED_SECRET,
						executionControlEnvironment.EXECUTION_AGENT_RUNTIME_SHARED_SECRET,
					],
					opsWebInternalToken: [
						existingSecrets.OPS_WEB_INTERNAL_TOKEN,
						executionControlEnvironment.OPS_WEB_INTERNAL_TOKEN,
						opsWebEnvironment.OPS_WEB_INTERNAL_TOKEN,
					],
				})
			: undefined;
	const executionSharedSecret = localSecrets?.executionSharedSecret ?? "";
	const opsWebInternalToken = localSecrets?.opsWebInternalToken ?? "";
	const shouldRender = (name: ManagedLocalEnvironment): boolean =>
		projections.some((target) => LOCAL_DEV_ENVIRONMENT_TARGETS[target].includes(name));
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
			APP_API_SAFETY_IDENTIFIER_HMAC_SECRET: localSecrets?.appApiSafetyIdentifierHmacSecret ?? "",
			AUTH_SHELL_ORIGIN: `http://127.0.0.1:${profile.ports.campusWeb}`,
			AUTH_TURNSTILE_SECRET_KEY: "local-turnstile-disabled",
			BETTER_AUTH_SECRET: localSecrets?.betterAuthSecret ?? "",
			EXECUTION_CONTROL_BASE_URL: `http://127.0.0.1:${runtimePorts.executionControl}`,
			OBJECT_STORE_DERIVED_ACCESS_KEY: "minioadmin",
			OBJECT_STORE_DERIVED_SECRET_KEY: "minioadmin",
			OBJECT_STORE_DERIVED_READ_ACCESS_KEY: "minioadmin",
			OBJECT_STORE_DERIVED_READ_SECRET_KEY: "minioadmin",
			OBJECT_STORE_LOCAL_BASE_URL: `http://127.0.0.1:9000/${profile.bucketName}/`,
			OPS_WEB_INTERNAL_TOKEN: opsWebInternalToken,
			RESEND_API_KEY: existingSecrets.RESEND_API_KEY || "local-resend-disabled",
			DEPLOYMENT_ENVIRONMENT: "development",
		});
	}
	if (shouldRender("campusWeb")) {
		writeManagedEnv(paths.campusWeb, {
			APP_API_BASE_URL: `http://127.0.0.1:${profile.ports.appApi}`,
			AUTH_TURNSTILE_SITE_KEY: "",
			CAMPUS_WEB_DEV_PORT: String(profile.ports.campusWeb),
			OBJECT_STORE_BUCKET_DERIVED: profile.bucketName,
			OBJECT_STORE_DERIVED_READ_ACCESS_KEY: "minioadmin",
			OBJECT_STORE_DERIVED_READ_SECRET_KEY: "minioadmin",
			OBJECT_STORE_ENDPOINT: "http://127.0.0.1:9000",
		});
	}
	if (shouldRender("executionControl")) {
		writeManagedEnv(paths.executionControl, {
			...noProxy,
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
			...(input.qdrant
				? {
						QDRANT_READ_ONLY_API_KEY: input.qdrant.readOnlyApiKey,
						QDRANT_URL: input.qdrant.url,
					}
				: {}),
		});
	}
	if (shouldRender("modelConfig")) {
		writeManagedEnv(paths.modelConfig, {
			...noProxy,
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
	if (shouldRender("opsWeb")) {
		writeManagedEnv(paths.opsWeb, {
			DEPLOYMENT_ENVIRONMENT: "local",
			NODE_ENV: "development",
			OPS_WEB_APP_API_URL: `http://127.0.0.1:${profile.ports.appApi}`,
			OPS_WEB_CAMPUS_WEB_URL: `http://127.0.0.1:${profile.ports.campusWeb}`,
			OBJECT_STORE_BUCKET_DERIVED: profile.bucketName,
			OBJECT_STORE_BUCKET_SOURCE: "campus-agent-source",
			OBJECT_STORE_SOURCE_ACCESS_KEY: "minioadmin",
			OBJECT_STORE_SOURCE_SECRET_KEY: "minioadmin",
			OBJECT_STORE_DERIVED_ACCESS_KEY: "minioadmin",
			OBJECT_STORE_DERIVED_SECRET_KEY: "minioadmin",
			OBJECT_STORE_DERIVED_READ_ACCESS_KEY: "minioadmin",
			OBJECT_STORE_DERIVED_READ_SECRET_KEY: "minioadmin",
			OBJECT_STORE_ENDPOINT: "http://127.0.0.1:9000",
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
			DEPLOYMENT_ENVIRONMENT: "local",
			NOTICES_DATABASE_SSLMODE: "disable",
			NOTICES_DATABASE_URL: database.noticePublisher,
			OPS_WEB_INTERNAL_URL: `http://127.0.0.1:${profile.ports.opsWebApi}`,
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
			DEPLOYMENT_ENVIRONMENT: "local",
			MODEL_CONFIG_URL: `http://127.0.0.1:${runtimePorts.modelConfig}`,
			NOTICES_DATABASE_SSLMODE: "disable",
			NOTICES_DATABASE_URL: database.noticePublisher,
		});
	}
	if (shouldRender("documentOcr")) {
		writeManagedEnv(paths.documentOcr, {
			DEPLOYMENT_ENVIRONMENT: "local",
			MODEL_CONFIG_URL: `http://127.0.0.1:${runtimePorts.modelConfig}`,
			NOTICES_DATABASE_SSLMODE: "disable",
			NOTICES_DATABASE_URL: database.owner,
			OBJECT_STORE_BUCKET_DERIVED: profile.bucketName,
			OBJECT_STORE_BUCKET_SOURCE: "campus-agent-source",
			OBJECT_STORE_DERIVED_ACCESS_KEY: "minioadmin",
			OBJECT_STORE_DERIVED_SECRET_KEY: "minioadmin",
			OBJECT_STORE_ENDPOINT: "http://127.0.0.1:9000",
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
	if (shouldRender("campusDocsIndexPublisher")) {
		writeManagedEnv(paths.campusDocsIndexPublisher, {
			EXECUTION_CONTROL_DATABASE_URL: database.owner,
			OBJECT_STORE_DERIVED_READ_ACCESS_KEY: "minioadmin",
			OBJECT_STORE_DERIVED_READ_SECRET_KEY: "minioadmin",
			OBJECT_STORE_ENDPOINT: "http://127.0.0.1:9000",
		});
	}
	if (shouldRender("campusRagIndexPublisher")) {
		if (!input.qdrant) {
			throw new Error("Campus RAG publisher requires a resolved local Qdrant connection.");
		}
		writeManagedEnv(paths.campusRagIndexPublisher, {
			EXECUTION_CONTROL_DATABASE_URL: database.owner,
			OBJECT_STORE_BUCKET_DERIVED: profile.bucketName,
			OBJECT_STORE_DERIVED_ACCESS_KEY: "minioadmin",
			OBJECT_STORE_DERIVED_SECRET_KEY: "minioadmin",
			OBJECT_STORE_DERIVED_READ_ACCESS_KEY: "minioadmin",
			OBJECT_STORE_DERIVED_READ_SECRET_KEY: "minioadmin",
			OBJECT_STORE_ENDPOINT: "http://127.0.0.1:9000",
			QDRANT_API_KEY: input.qdrant.apiKey,
			QDRANT_URL: input.qdrant.url,
		});
	}
	if (shouldRender("noticeIndexPublisher")) {
		writeManagedEnv(paths.noticeIndexPublisher, {
			DEPLOYMENT_ENVIRONMENT: "local",
			NOTICES_DATABASE_SSLMODE: "disable",
			NOTICES_DATABASE_URL: database.owner,
		});
	}
	return selectedPaths;
}

export function resolveLocalModelConfigEncryptionKeyPath(repoRoot: string): string {
	return resolve(repoRoot, LOCAL_MODEL_CONFIG_ENCRYPTION_KEY_PATH);
}

export function ensureLocalModelConfigEncryptionKey(repoRoot: string): string {
	return ensurePrivateEncryptionKey(resolveLocalModelConfigEncryptionKeyPath(repoRoot));
}

export function removeLocalModelConfigEncryptionKey(repoRoot: string): void {
	rmSync(resolveLocalModelConfigEncryptionKeyPath(repoRoot), { force: true });
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

export function removeLocalEnvironmentFiles(
	repoRoot: string,
	projections: readonly LocalDevEnvironmentProjection[] = Object.keys(
		LOCAL_DEV_ENVIRONMENT_TARGETS,
	) as LocalDevEnvironmentProjection[],
): { removed: string[]; skippedUnmanaged: string[] } {
	const removed: string[] = [];
	const skippedUnmanaged: string[] = [];
	for (const resolved of managedLocalEnvironmentPathsForProjections(repoRoot, projections)) {
		if (!existsSync(resolved)) {
			continue;
		}
		if (!isManagedFile(resolved)) {
			skippedUnmanaged.push(resolved);
			continue;
		}
		rmSync(resolved, { force: true });
		removed.push(resolved);
	}
	return { removed, skippedUnmanaged };
}

export function assertLocalEnvironmentFilesAreManaged(
	repoRoot: string,
	selection: LocalDevEnvironmentTarget | readonly LocalDevEnvironmentProjection[] = Object.keys(
		LOCAL_DEV_ENVIRONMENT_TARGETS,
	) as LocalDevEnvironmentProjection[],
): void {
	const paths =
		typeof selection === "string"
			? managedLocalEnvironmentPathsForTarget(repoRoot, selection)
			: managedLocalEnvironmentPathsForProjections(repoRoot, selection);
	for (const resolved of paths) {
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
	return parseEnvironment(readFileSync(path, "utf8"));
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
	const internalPortalSsoTgc = readOptionalEnv(
		resolve(mainCheckoutRoot, MAIN_INTERNAL_PORTAL_ENV_PATH),
	).INTERNAL_PORTAL_SSO_TGC?.trim();
	return {
		...(internalPortalSsoTgc ? { internalPortalSsoTgc } : {}),
		provider,
	};
}

function readOptionalEnv(path: string): Record<string, string> {
	return existsSync(path) ? parseEnvironment(readFileSync(path, "utf8")) : {};
}

function appendMissingEnvValues(path: string, values: Record<string, string>): void {
	const current = existsSync(path) ? readFileSync(path, "utf8") : "";
	const parsed = current ? parseEnvironment(current) : {};
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

function parseEnvironment(body: string): Record<string, string> {
	const parsed = parseEnv(body);
	return Object.fromEntries(
		Object.entries(parsed).filter(
			(entry): entry is [string, string] => typeof entry[1] === "string",
		),
	);
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
	if (!isManagedFile(path)) {
		throw new Error(`Refusing to overwrite unmanaged local environment file: ${path}`);
	}
}

function isManagedFile(path: string): boolean {
	return readFileSync(path, "utf8").startsWith(MANAGED_LOCAL_ENV_MARKER);
}

export function isLocalManagedFile(path: string): boolean {
	return existsSync(path) && isManagedFile(path);
}

export function isPrivateLocalFile(path: string): boolean {
	try {
		return (statSync(path).mode & 0o077) === 0;
	} catch {
		return false;
	}
}

export const LOCAL_DEV_DATABASE_PASSWORDS = LOCAL_DATABASE_PASSWORDS;
