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
import { ensureLocalInfrastructureSecrets } from "./infrastructure-secrets";
import type { LocalQdrantConnection } from "./local-qdrant";
import { ensureLocalDevSecrets } from "./local-secrets";
import type { LocalDevProfile } from "./profile";
import { calculateLocalDevInfrastructurePorts, calculateLocalDevRuntimePorts } from "./profile";
import {
	type LocalDevEnvironmentProjection,
	type LocalDevTarget,
	type LocalModelConfigName,
	resolveLocalDevTargetPlan,
} from "./targets";

export const MANAGED_LOCAL_ENV_MARKER = "# Managed by pnpm dev:init. Do not edit.";
const LOCAL_MODEL_CONFIG_ENCRYPTION_KEY_PATH = "var/dev/model-config-encryption.key";
const IMPORTED_EXTERNAL_ENV_MARKER =
	"# External development credentials imported from the main checkout by pnpm dev:local credentials import.";

const SHARED_EXTERNAL_PROVIDER_ENV_KEYS = [
	"HINDSIGHT_API_LLM_API_KEY",
	"HINDSIGHT_API_LLM_BASE_URL",
	"HINDSIGHT_API_LLM_MODEL",
	"HINDSIGHT_API_LLM_PROVIDER",
	"HINDSIGHT_API_EMBEDDINGS_OPENAI_API_KEY",
	"HINDSIGHT_API_EMBEDDINGS_OPENAI_BASE_URL",
	"HINDSIGHT_API_EMBEDDINGS_OPENAI_MODEL",
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
	agentControl: "apps/agent-control/.env.local",
	campusSearch: "apps/campus-search/.env.local",
	modelConfig: "apps/model-config/.env.local",
	agentRuntime: "apps/agent-runtime/.env.local",
	memoryService: "apps/memory-service/.env.local",
	clusterPrivateIngress: "apps/cluster-private-ingress/.env.local",
	noticeClassifier: "jobs/notice-classifier/.env.local",
	noticePublisher: "jobs/notice-publisher/.env.local",
	opsWeb: "apps/ops-web/.env.local",
	internalPortalCollection: "jobs/internal-portal-collection/adapters/internal-portal/.env.local",
	campusDocsIndexPublisher: "jobs/campus-docs-index-publisher/.env.local",
	noticePipelineWorker: "apps/notice-pipeline-worker/.env.local",
	campusRagIndexPublisher: "jobs/retrieval-index/.env.local",
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
	"app-api": ["appApi", "appApiVars"],
	core: [
		"appApi",
		"appApiVars",
		"campusWeb",
		"modelConfig",
		"campusSearch",
		"agentControl",
		"agentRuntime",
		"memoryService",
		"clusterPrivateIngress",
	],
	"model-config": ["modelConfig"],
	"ops-web": ["opsWeb"],
	"notice-publisher": ["noticePublisher"],
	"internal-portal-collection": ["internalPortalCollection"],
	"notice-classifier": ["noticeClassifier"],
	"campus-docs-index-publisher": ["campusDocsIndexPublisher"],
	"retrieval-index": ["campusRagIndexPublisher"],
	"notice-pipeline-worker": ["noticePipelineWorker"],
	"notice-index-publisher": ["noticeIndexPublisher"],
};

export const LOCAL_DATABASE_PASSWORDS = {
	memory: "campus-agent-local-memory",
	appApi: "campus-agent-local-app-api",
	agentControl: "campus-agent-local-agent-control",
	campusSearch: "campus-agent-local-campus-search",
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

export function localDatabaseUrls(profile: LocalDevProfile): {
	memory: string;
	appApi: string;
	agentControl: string;
	campusSearch: string;
	modelConfig: string;
	opsWeb: string;
	noticePublisher: string;
	owner: string;
} {
	const infraPorts = profile.infraPorts ?? calculateLocalDevInfrastructurePorts(profile.slot);
	const url = (role: string, password: string) =>
		`postgresql://${role}:${encodeURIComponent(password)}@127.0.0.1:${infraPorts.postgres}/${profile.databaseName}`;
	return {
		memory: url("memory_service", LOCAL_DATABASE_PASSWORDS.memory).replace(
			`/${profile.databaseName}`,
			`/${profile.databaseName}_memory`,
		),
		appApi: url("app_api", LOCAL_DATABASE_PASSWORDS.appApi),
		agentControl: url("agent_control", LOCAL_DATABASE_PASSWORDS.agentControl),
		campusSearch: url("campus_search", LOCAL_DATABASE_PASSWORDS.campusSearch),
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
	profile: LocalDevProfile;
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
	profile: LocalDevProfile;
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
	const infrastructure = ensureLocalInfrastructureSecrets(repoRoot, profile as LocalDevProfile);
	const infraPorts =
		(profile as LocalDevProfile).infraPorts ?? calculateLocalDevInfrastructurePorts(profile.slot);
	const objectStoreEndpoint = `http://127.0.0.1:${infraPorts.objectStore}`;
	const objectStore = {
		OBJECT_STORE_DERIVED_ACCESS_KEY: infrastructure.objectStoreAccessKey,
		OBJECT_STORE_DERIVED_READ_ACCESS_KEY: infrastructure.objectStoreAccessKey,
		OBJECT_STORE_DERIVED_READ_SECRET_KEY: infrastructure.objectStoreSecretKey,
		OBJECT_STORE_DERIVED_SECRET_KEY: infrastructure.objectStoreSecretKey,
		OBJECT_STORE_ENDPOINT: objectStoreEndpoint,
		OBJECT_STORE_SOURCE_ACCESS_KEY: infrastructure.objectStoreAccessKey,
		OBJECT_STORE_SOURCE_SECRET_KEY: infrastructure.objectStoreSecretKey,
	};
	const paths = managedLocalEnvironmentPaths(repoRoot);
	const noProxy = localNoProxyEnvironment(repoRoot, input.environment ?? process.env);
	const runtimePorts = calculateLocalDevRuntimePorts(profile.slot);
	const rendersCore = projections.includes("core");
	const rendersAppApi = rendersCore || projections.includes("app-api");
	const rendersOpsWeb = projections.includes("ops-web");
	const rendersInternalPortalCollection = projections.includes("internal-portal-collection");
	const existingSecrets = rendersAppApi ? readManagedEnv(paths.appApiVars) : {};
	const agentControlEnvironment = rendersCore ? readManagedEnv(paths.agentControl) : {};
	const opsWebEnvironment = rendersOpsWeb ? readManagedEnv(paths.opsWeb) : {};
	const existingInternalPortalCollectionEnvironment = rendersInternalPortalCollection
		? readManagedEnv(paths.internalPortalCollection)
		: {};
	const localSecrets =
		rendersAppApi || rendersOpsWeb || rendersInternalPortalCollection
			? ensureLocalDevSecrets(repoRoot, {
					appApiSafetyIdentifierHmacSecret: [existingSecrets.APP_API_SAFETY_IDENTIFIER_HMAC_SECRET],
					betterAuthSecret: [existingSecrets.BETTER_AUTH_SECRET],
					internalSharedSecret: [
						existingSecrets.APP_API_INTERNAL_SHARED_SECRET,
						agentControlEnvironment.AGENT_CONTROL_RUNTIME_SHARED_SECRET,
					],
					edgeIngressSecret: [existingSecrets.EDGE_INGRESS_SHARED_SECRET],
					controlIngressSecret: [agentControlEnvironment.AGENT_CONTROL_INGRESS_SHARED_SECRET],
					memoryInternalSecret: [],
					opsWebInternalToken: [
						existingSecrets.OPS_WEB_INTERNAL_TOKEN,
						agentControlEnvironment.OPS_WEB_INTERNAL_TOKEN,
						opsWebEnvironment.OPS_WEB_INTERNAL_TOKEN,
					],
				})
			: undefined;
	const internalSharedSecret = localSecrets?.internalSharedSecret ?? "";
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
			APP_API_INTERNAL_SHARED_SECRET: internalSharedSecret,
			APP_API_SAFETY_IDENTIFIER_HMAC_SECRET: localSecrets?.appApiSafetyIdentifierHmacSecret ?? "",
			AUTH_SHELL_ORIGIN: `http://127.0.0.1:${profile.ports.campusWeb}`,
			AUTH_TURNSTILE_SECRET_KEY: "local-turnstile-disabled",
			BETTER_AUTH_SECRET: localSecrets?.betterAuthSecret ?? "",
			CLUSTER_PRIVATE_BASE_URL: `http://127.0.0.1:${runtimePorts.clusterPrivateIngress}`,
			EDGE_INGRESS_SHARED_SECRET: localSecrets?.edgeIngressSecret ?? "",
			...objectStore,
			OBJECT_STORE_LOCAL_BASE_URL: `${objectStoreEndpoint}/${profile.bucketName}/`,
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
			...objectStore,
			OBJECT_STORE_BUCKET_DERIVED: profile.bucketName,
		});
	}
	if (shouldRender("clusterPrivateIngress")) {
		writeManagedEnv(paths.clusterPrivateIngress, {
			LISTEN_ADDR: `127.0.0.1:${runtimePorts.clusterPrivateIngress}`,
			EDGE_INGRESS_SHARED_SECRET: localSecrets?.edgeIngressSecret ?? "",
			AGENT_CONTROL_BASE_URL: `http://127.0.0.1:${runtimePorts.agentControl}`,
			AGENT_CONTROL_INGRESS_SHARED_SECRET: localSecrets?.controlIngressSecret ?? "",
			MEMORY_SERVICE_BASE_URL: `http://127.0.0.1:${runtimePorts.memoryApi}`,
			MEMORY_INTERNAL_SHARED_SECRET: localSecrets?.memoryInternalSecret ?? "",
		});
	}
	if (shouldRender("agentControl")) {
		writeManagedEnv(paths.agentControl, {
			AGENT_CONTROL_INGRESS_SHARED_SECRET: localSecrets?.controlIngressSecret ?? "",
			...noProxy,
			APP_API_INTERNAL_SHARED_SECRET: internalSharedSecret,
			DEPLOYMENT_ENVIRONMENT: "development",
			DEPLOYMENT_RELEASE: `agent-control@${profile.instanceId}`,
			AGENT_CONTROL_RUNTIME_SHARED_SECRET: internalSharedSecret,
			AGENT_CONTROL_DATABASE_URL: database.agentControl,

			MEMORY_SERVICE_BASE_URL: `http://127.0.0.1:${runtimePorts.memoryApi}`,
			MEMORY_INTERNAL_SHARED_SECRET: localSecrets?.memoryInternalSecret ?? "",
			MODEL_CONFIG_URL: `http://127.0.0.1:${runtimePorts.modelConfig}`,
			AGENT_CONTROL_PRODUCT_CALLBACK_BASE_URL: `http://127.0.0.1:${profile.ports.appApi}`,
			AGENT_CONTROL_TEMPORAL_ADDRESS: `127.0.0.1:${infraPorts.temporal}`,
			AGENT_CONTROL_TEMPORAL_NAMESPACE: `campus-agent-local-${profile.instanceId}`,
			AGENT_CONTROL_TEMPORAL_WORKER_IDENTITY: `${profile.instanceId}:agent-control`,
			HOST: "127.0.0.1",
			PORT: String(runtimePorts.agentControl),
		});
	}
	if (shouldRender("memoryService")) {
		writeManagedEnv(paths.memoryService, {
			...noProxy,
			MEMORY_HOST: "127.0.0.1",
			MEMORY_PORT: String(runtimePorts.memoryApi),
			MEMORY_WORKER_PORT: String(runtimePorts.memoryWorker),
			MEMORY_DATABASE_URL: database.memory,
			MEMORY_INTERNAL_SHARED_SECRET: localSecrets?.memoryInternalSecret ?? "",
			MEMORY_TEMPORAL_ADDRESS: `127.0.0.1:${infraPorts.temporal}`,
			MEMORY_TEMPORAL_NAMESPACE: `campus-agent-local-${profile.instanceId}`,
			APP_PRODUCT_CALLBACK_BASE_URL: `http://127.0.0.1:${profile.ports.appApi}`,
			APP_PRODUCT_CALLBACK_SHARED_SECRET: internalSharedSecret,
			HINDSIGHT_API_BASE_URL: `http://127.0.0.1:${infraPorts.hindsightApi}`,
			HINDSIGHT_API_TENANT_API_KEY: infrastructure.hindsightTenantKey,
			HINDSIGHT_OWNER_SALT: infrastructure.hindsightOwnerSalt,
		});
	}
	if (shouldRender("campusSearch")) {
		writeManagedEnv(paths.campusSearch, {
			...noProxy,
			DEPLOYMENT_ENVIRONMENT: "development",
			CAMPUS_SEARCH_DATABASE_URL: database.campusSearch,
			CAMPUS_SEARCH_MODEL_CONFIG_URL: `http://127.0.0.1:${runtimePorts.modelConfig}`,
			RETRIEVAL_INTERNAL_TOKEN: internalSharedSecret,
			HOST: "127.0.0.1",
			PORT: String(runtimePorts.campusSearch),
			...(input.qdrant
				? {
						CAMPUS_SEARCH_QDRANT_READ_ONLY_API_KEY: input.qdrant.readOnlyApiKey,
						CAMPUS_SEARCH_QDRANT_URL: input.qdrant.url,
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
			AGENT_CONTROL_BASE_URL: `http://127.0.0.1:${runtimePorts.agentControl}`,
			AGENT_RUNTIME_TEMPORAL_ADDRESS: `127.0.0.1:${infraPorts.temporal}`,
			AGENT_RUNTIME_TEMPORAL_NAMESPACE: `campus-agent-local-${profile.instanceId}`,
			RETRIEVAL_BASE_URL: `http://127.0.0.1:${runtimePorts.campusSearch}`,
			RETRIEVAL_INTERNAL_TOKEN: internalSharedSecret,

			MEMORY_SERVICE_BASE_URL: `http://127.0.0.1:${runtimePorts.memoryApi}`,
			MEMORY_INTERNAL_SHARED_SECRET: localSecrets?.memoryInternalSecret ?? "",
			AGENT_WORKER_PORT: String(runtimePorts.agentWorker),
			DEPLOYMENT_ENVIRONMENT: "development",
			DEPLOYMENT_RELEASE: `agent-runtime@${profile.instanceId}`,
			AGENT_CONTROL_RUNTIME_SHARED_SECRET: internalSharedSecret,
			HOST: "127.0.0.1",
			MODEL_CONFIG_URL: `http://127.0.0.1:${runtimePorts.modelConfig}`,
		});
	}
	if (shouldRender("opsWeb")) {
		writeManagedEnv(paths.opsWeb, {
			DEPLOYMENT_ENVIRONMENT: "local",
			NODE_ENV: "development",
			OPS_WEB_APP_API_URL: `http://127.0.0.1:${profile.ports.appApi}`,
			OPS_WEB_CAMPUS_WEB_URL: `http://127.0.0.1:${profile.ports.campusWeb}`,
			OBJECT_STORE_BUCKET_DERIVED: profile.bucketName,
			...objectStore,
			OBJECT_STORE_BUCKET_SOURCE: profile.sourceBucketName,
			OPS_WEB_DATABASE_SSLMODE: "disable",
			OPS_WEB_DATABASE_URL: database.opsWeb,
			MODEL_CONFIG_URL: `http://127.0.0.1:${runtimePorts.modelConfig}`,
			OPS_WEB_INTERNAL_TOKEN: opsWebInternalToken,
			OPS_WEB_AUTOMATION_ORIGIN: `http://127.0.0.1:${profile.ports.opsWebApi}`,
			OPS_WEB_PUBLIC_ORIGIN: `http://127.0.0.1:${profile.ports.opsWeb}`,
			OPS_WEB_WEB_PORT: String(profile.ports.opsWeb),
			PORT: String(profile.ports.opsWebApi),
			TEMPORAL_ADDRESS: `127.0.0.1:${infraPorts.temporal}`,
			TEMPORAL_NAMESPACE: `campus-agent-local-${profile.instanceId}`,
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
			OPS_WEB_INTERNAL_URL: `http://127.0.0.1:${profile.ports.opsWeb}`,
			...objectStore,
			OBJECT_STORE_BUCKET_SOURCE: profile.sourceBucketName,
			OBJECT_STORE_REGION: "us-east-1",
			OBJECT_STORE_SOURCE_ACCESS_KEY: infrastructure.objectStoreAccessKey,
			OBJECT_STORE_SOURCE_SECRET_KEY: infrastructure.objectStoreSecretKey,
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
			...objectStore,
			OBJECT_STORE_BUCKET_SOURCE: profile.sourceBucketName,
		});
	}
	if (shouldRender("noticePublisher")) {
		writeManagedEnv(paths.noticePublisher, {
			DEPLOYMENT_ENVIRONMENT: "local",
			NOTICES_DATABASE_SSLMODE: "disable",
			NOTICES_DATABASE_URL: database.noticePublisher,
			OBJECT_STORE_BUCKET_DERIVED: profile.bucketName,
			...objectStore,
			OBJECT_STORE_BUCKET_SOURCE: profile.sourceBucketName,
		});
	}
	if (shouldRender("campusDocsIndexPublisher")) {
		writeManagedEnv(paths.campusDocsIndexPublisher, {
			AGENT_CONTROL_DATABASE_URL: database.owner,
			...objectStore,
			OBJECT_STORE_BUCKET_DERIVED: profile.bucketName,
		});
	}
	if (shouldRender("noticePipelineWorker")) {
		writeManagedEnv(paths.noticePipelineWorker, {
			DEPLOYMENT_ENVIRONMENT: "local",
			NOTICES_DATABASE_SSLMODE: "disable",
			NOTICES_DATABASE_URL: database.owner,
			AGENT_CONTROL_DATABASE_URL: database.owner,
			MODEL_CONFIG_URL: `http://127.0.0.1:${runtimePorts.modelConfig}`,
			TEMPORAL_ADDRESS: `127.0.0.1:${infraPorts.temporal}`,
			TEMPORAL_NAMESPACE: `campus-agent-local-${profile.instanceId}`,
			OBJECT_STORE_BUCKET_SOURCE: profile.sourceBucketName,
			OBJECT_STORE_BUCKET_DERIVED: profile.bucketName,
			...objectStore,
		});
	}
	if (shouldRender("campusRagIndexPublisher")) {
		if (!input.qdrant) {
			throw new Error("Retrieval index requires a resolved local Qdrant connection.");
		}
		writeManagedEnv(paths.campusRagIndexPublisher, {
			DEPLOYMENT_ENVIRONMENT: "local",
			NOTICES_DATABASE_URL: database.owner,
			NOTICES_DATABASE_SSLMODE: "disable",
			MODEL_CONFIG_URL: `http://127.0.0.1:${runtimePorts.modelConfig}`,
			AGENT_CONTROL_DATABASE_URL: database.agentControl,
			...objectStore,
			OBJECT_STORE_BUCKET_DERIVED: profile.bucketName,
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
	mkdirSync(dirname(path), { recursive: true });
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
