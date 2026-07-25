import { createHash } from "node:crypto";
import {
	ApiException,
	AppsV1Api,
	CoreV1Api,
	KubeConfig,
	type V1Deployment,
	type V1Secret,
} from "@kubernetes/client-node";
import type { z } from "zod";
import type {
	HindsightModelSettingsStatus,
	HindsightModelSettingsUpdateSchema,
} from "../shared/ops-contract.ts";

const SECRET_NAME = "hindsight-model-config";
const DEPLOYMENT_NAME = "hindsight-api";
const UPDATED_AT_ANNOTATION = "campus-agent.io/hindsight-model-config-updated-at";
const UPDATED_BY_ANNOTATION = "campus-agent.io/hindsight-model-config-updated-by";
const DIGEST_ANNOTATION = "campus-agent.io/hindsight-model-config-digest";
const RESTARTED_AT_ANNOTATION = "campus-agent.io/hindsight-restarted-at";

const LLM_API_KEY = "HINDSIGHT_API_LLM_API_KEY";
const LLM_BASE_URL = "HINDSIGHT_API_LLM_BASE_URL";
const LLM_MODEL = "HINDSIGHT_API_LLM_MODEL";
const LLM_PROVIDER = "HINDSIGHT_API_LLM_PROVIDER";
const LLM_DEFAULT_HEADERS = "HINDSIGHT_API_LLM_DEFAULT_HEADERS";
const EMBEDDING_API_KEY = "HINDSIGHT_API_EMBEDDINGS_OPENAI_API_KEY";
const EMBEDDING_BASE_URL = "HINDSIGHT_API_EMBEDDINGS_OPENAI_BASE_URL";
const EMBEDDING_MODEL = "HINDSIGHT_API_EMBEDDINGS_OPENAI_MODEL";
const EMBEDDING_PROVIDER = "HINDSIGHT_API_EMBEDDINGS_PROVIDER";
const RERANKER_PROVIDER = "HINDSIGHT_API_RERANKER_PROVIDER";
const FIXED_EMBEDDING_MODEL = "Qwen3-Embedding-4B";
const FIXED_EMBEDDING_PROVIDER = "openai";
const FIXED_RERANKER_PROVIDER = "rrf";

interface KubernetesSecretApi {
	patchNamespacedSecret(input: {
		body: unknown;
		fieldManager?: string;
		name: string;
		namespace: string;
	}): Promise<V1Secret>;
	readNamespacedSecret(input: { name: string; namespace: string }): Promise<V1Secret>;
}

interface KubernetesDeploymentApi {
	patchNamespacedDeployment(input: {
		body: unknown;
		fieldManager?: string;
		name: string;
		namespace: string;
	}): Promise<V1Deployment>;
	readNamespacedDeployment(input: { name: string; namespace: string }): Promise<V1Deployment>;
}

export interface HindsightModelSettingsStore {
	apply(input: { appliedAt: string }): Promise<HindsightModelSettingsStatus>;
	getStatus(): Promise<HindsightModelSettingsStatus>;
	replaceSettings(input: {
		etag: string;
		settings: z.infer<typeof HindsightModelSettingsUpdateSchema>;
		updatedAt: string;
		updatedBy: string;
	}): Promise<HindsightModelSettingsStatus>;
}

export class HindsightModelSettingsStoreUnavailableError extends Error {
	readonly reasonCode: string;

	constructor(reasonCode: string) {
		super("hindsight model settings store is unavailable");
		this.name = "HindsightModelSettingsStoreUnavailableError";
		this.reasonCode = reasonCode;
	}
}

export class HindsightModelSettingsConflictError extends Error {
	constructor() {
		super("hindsight model settings changed");
		this.name = "HindsightModelSettingsConflictError";
	}
}

export function createKubernetesHindsightModelSettingsStore(input?: {
	deploymentApi?: KubernetesDeploymentApi;
	namespace?: string;
	secretApi?: KubernetesSecretApi;
}): HindsightModelSettingsStore {
	const runtime =
		input?.deploymentApi && input.secretApi && input.namespace ? input : createInClusterRuntime();
	if (!(runtime.deploymentApi && runtime.secretApi && runtime.namespace)) {
		throw new HindsightModelSettingsStoreUnavailableError("KUBERNETES_CONFIG_UNAVAILABLE");
	}
	const { deploymentApi, namespace, secretApi } = runtime;

	async function readResources() {
		try {
			const [secret, deployment] = await Promise.all([
				secretApi.readNamespacedSecret({ name: SECRET_NAME, namespace }),
				deploymentApi.readNamespacedDeployment({ name: DEPLOYMENT_NAME, namespace }),
			]);
			return { deployment, secret };
		} catch (error) {
			throw sanitizeKubernetesError(error);
		}
	}

	return {
		async apply(input) {
			const { deployment, secret } = await readResources();
			const digest = modelConfigDigest(secret.data ?? {});
			const configState = modelConfigState(secret.data ?? {});
			if (configState === "unconfigured") {
				throw new HindsightModelSettingsStoreUnavailableError("MODEL_CONFIG_INCOMPLETE");
			}
			if (configState === "drifted") {
				throw new HindsightModelSettingsStoreUnavailableError("MODEL_CONFIG_DRIFTED");
			}
			const resourceVersion = deployment.metadata?.resourceVersion?.trim();
			if (!resourceVersion) {
				throw new HindsightModelSettingsStoreUnavailableError(
					"KUBERNETES_RESOURCE_VERSION_MISSING",
				);
			}
			try {
				const updated = await deploymentApi.patchNamespacedDeployment({
					body: deploymentPatchOperations({
						appliedAt: input.appliedAt,
						current: deployment,
						digest,
						resourceVersion,
					}),
					fieldManager: "ops-web",
					name: DEPLOYMENT_NAME,
					namespace,
				});
				return statusFromResources(secret, updated);
			} catch (error) {
				throw sanitizeKubernetesError(error);
			}
		},
		async getStatus() {
			const { deployment, secret } = await readResources();
			return statusFromResources(secret, deployment);
		},
		async replaceSettings(input) {
			let current: V1Secret;
			try {
				current = await secretApi.readNamespacedSecret({ name: SECRET_NAME, namespace });
			} catch (error) {
				throw sanitizeKubernetesError(error);
			}
			const data = { ...(current.data ?? {}) };
			if (input.etag !== secretEtag(current)) {
				throw new HindsightModelSettingsConflictError();
			}
			const currentLLMBaseUrl = decodeSecretValue(data[LLM_BASE_URL]);
			const llmApiKey = input.settings.llm.apiKey?.trim();
			const embeddingApiKey = input.settings.embedding.apiKey?.trim();
			if (!(llmApiKey || decodeSecretValue(data[LLM_API_KEY]))) {
				throw new HindsightModelSettingsStoreUnavailableError("LLM_API_KEY_REQUIRED");
			}
			if (!(embeddingApiKey || decodeSecretValue(data[EMBEDDING_API_KEY]))) {
				throw new HindsightModelSettingsStoreUnavailableError("EMBEDDING_API_KEY_REQUIRED");
			}
			const updates: Record<string, string> = {
				[LLM_BASE_URL]: encodeSecretValue(input.settings.llm.baseUrl),
				[LLM_MODEL]: encodeSecretValue(input.settings.llm.model),
				[LLM_PROVIDER]: encodeSecretValue("openai"),
				[EMBEDDING_BASE_URL]: encodeSecretValue(input.settings.embedding.baseUrl),
				[EMBEDDING_MODEL]: encodeSecretValue(FIXED_EMBEDDING_MODEL),
				[EMBEDDING_PROVIDER]: encodeSecretValue(FIXED_EMBEDDING_PROVIDER),
				[RERANKER_PROVIDER]: encodeSecretValue(FIXED_RERANKER_PROVIDER),
			};
			if (llmApiKey) {
				updates[LLM_API_KEY] = encodeSecretValue(llmApiKey);
			}
			if (embeddingApiKey) {
				updates[EMBEDDING_API_KEY] = encodeSecretValue(embeddingApiKey);
			}
			const annotations = {
				...(current.metadata?.annotations ?? {}),
				[UPDATED_AT_ANNOTATION]: input.updatedAt,
				[UPDATED_BY_ANNOTATION]: input.updatedBy,
			};
			try {
				const updated = await secretApi.patchNamespacedSecret({
					body: secretPatchOperations({
						annotations,
						current,
						removeDefaultHeaders:
							Boolean(data[LLM_DEFAULT_HEADERS]) &&
							Boolean(currentLLMBaseUrl) &&
							currentLLMBaseUrl !== input.settings.llm.baseUrl,
						updates,
					}),
					fieldManager: "ops-web",
					name: SECRET_NAME,
					namespace,
				});
				const deployment = await deploymentApi.readNamespacedDeployment({
					name: DEPLOYMENT_NAME,
					namespace,
				});
				return statusFromResources(updated, deployment);
			} catch (error) {
				throw sanitizeKubernetesError(error);
			}
		},
	};
}

export function createUnavailableHindsightModelSettingsStore(
	reasonCode = "KUBERNETES_CONFIG_UNAVAILABLE",
): HindsightModelSettingsStore {
	const unavailable = async (): Promise<never> => {
		throw new HindsightModelSettingsStoreUnavailableError(reasonCode);
	};
	return { apply: unavailable, getStatus: unavailable, replaceSettings: unavailable };
}

function createInClusterRuntime(): {
	deploymentApi: KubernetesDeploymentApi;
	namespace: string;
	secretApi: KubernetesSecretApi;
} {
	try {
		const kubeConfig = new KubeConfig();
		kubeConfig.loadFromCluster();
		const namespace = kubeConfig
			.getContextObject(kubeConfig.getCurrentContext())
			?.namespace?.trim();
		if (!namespace) {
			throw new Error("Kubernetes namespace is unavailable");
		}
		return {
			deploymentApi: kubeConfig.makeApiClient(AppsV1Api),
			namespace,
			secretApi: kubeConfig.makeApiClient(CoreV1Api),
		};
	} catch {
		throw new HindsightModelSettingsStoreUnavailableError("KUBERNETES_CONFIG_UNAVAILABLE");
	}
}

function statusFromResources(
	secret: V1Secret,
	deployment: V1Deployment,
): HindsightModelSettingsStatus {
	const data = secret.data ?? {};
	const digest = modelConfigDigest(data);
	const appliedDigest = deployment.spec?.template.metadata?.annotations?.[DIGEST_ANNOTATION];
	const configState = modelConfigState(data);
	const runtimeState = deploymentRuntimeState(deployment);
	const applyState = deploymentApplyState(
		deployment,
		configState,
		runtimeState,
		digest,
		appliedDigest,
	);
	return {
		applyState,
		configState,
		etag: secretEtag(secret),
		embedding: {
			baseUrl: decodeSecretValue(data[EMBEDDING_BASE_URL]) || null,
			credentialConfigured: Boolean(decodeSecretValue(data[EMBEDDING_API_KEY])),
			credentialLast4: secretLast4(data[EMBEDDING_API_KEY]),
			dimensions: 2560,
			model: "Qwen3-Embedding-4B",
		},
		llm: {
			baseUrl: decodeSecretValue(data[LLM_BASE_URL]) || null,
			credentialConfigured: Boolean(decodeSecretValue(data[LLM_API_KEY])),
			credentialLast4: secretLast4(data[LLM_API_KEY]),
			model: decodeSecretValue(data[LLM_MODEL]) || null,
			provider: "openai",
		},
		failure: applyState === "failed" ? deploymentFailure(deployment) : null,
		rerank: { provider: "rrf" },
		runtimeState,
		sampledAt: new Date().toISOString(),
		updatedAt: validIsoTimestamp(secret.metadata?.annotations?.[UPDATED_AT_ANNOTATION]),
		updatedBy: normalizedNullable(secret.metadata?.annotations?.[UPDATED_BY_ANNOTATION]),
	};
}

function deploymentFailure(deployment: V1Deployment): HindsightModelSettingsStatus["failure"] {
	const conditions = deployment.status?.conditions ?? [];
	const replicaFailure = conditions.find(
		(condition) => condition.type === "ReplicaFailure" && condition.status === "True",
	);
	if (replicaFailure) {
		return {
			message: sanitizeRolloutMessage(replicaFailure.message),
			reasonCode: "HINDSIGHT_REPLICA_FAILURE",
		};
	}
	const stalled = conditions.find(
		(condition) => condition.type === "Progressing" && condition.status === "False",
	);
	return stalled
		? {
				message: sanitizeRolloutMessage(stalled.message),
				reasonCode: "HINDSIGHT_ROLLOUT_STALLED",
			}
		: null;
}

function sanitizeRolloutMessage(value: string | undefined) {
	const message = value?.replace(/\s+/gu, " ").trim();
	return message ? message.slice(0, 512) : null;
}

function secretEtag(secret: V1Secret) {
	return secret.metadata?.resourceVersion?.trim() || modelConfigDigest(secret.data ?? {});
}

function secretPatchOperations(input: {
	annotations: Record<string, string>;
	current: V1Secret;
	removeDefaultHeaders: boolean;
	updates: Record<string, string>;
}) {
	const operations: Array<{ op: string; path: string; value?: unknown }> = [];
	const resourceVersion = input.current.metadata?.resourceVersion?.trim();
	if (resourceVersion) {
		operations.push({ op: "test", path: "/metadata/resourceVersion", value: resourceVersion });
	}
	if (!input.current.data) {
		operations.push({ op: "add", path: "/data", value: {} });
	}
	for (const [key, value] of Object.entries(input.updates)) {
		operations.push({ op: "add", path: `/data/${key}`, value });
	}
	if (input.removeDefaultHeaders) {
		operations.push({ op: "remove", path: `/data/${LLM_DEFAULT_HEADERS}` });
	}
	operations.push({ op: "add", path: "/metadata/annotations", value: input.annotations });
	return operations;
}

function deploymentPatchOperations(input: {
	appliedAt: string;
	current: V1Deployment;
	digest: string;
	resourceVersion: string;
}) {
	const operations: Array<{ op: string; path: string; value?: unknown }> = [
		{
			op: "test",
			path: "/metadata/resourceVersion",
			value: input.resourceVersion,
		},
	];
	if (!input.current.spec?.template.metadata) {
		operations.push({ op: "add", path: "/spec/template/metadata", value: { annotations: {} } });
	} else if (!input.current.spec.template.metadata.annotations) {
		operations.push({ op: "add", path: "/spec/template/metadata/annotations", value: {} });
	}
	operations.push(
		{
			op: "add",
			path: `/spec/template/metadata/annotations/${jsonPointerSegment(DIGEST_ANNOTATION)}`,
			value: input.digest,
		},
		{
			op: "add",
			path: `/spec/template/metadata/annotations/${jsonPointerSegment(RESTARTED_AT_ANNOTATION)}`,
			value: input.appliedAt,
		},
	);
	return operations;
}

function jsonPointerSegment(value: string) {
	return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

type ModelConfigState = "unconfigured" | "drifted" | "configured";

function deploymentRuntimeState(
	deployment: V1Deployment,
): HindsightModelSettingsStatus["runtimeState"] {
	return (deployment.spec?.replicas ?? 1) === 0 ? "scaled_down" : "running";
}

function deploymentApplyState(
	deployment: V1Deployment,
	configState: ModelConfigState,
	runtimeState: HindsightModelSettingsStatus["runtimeState"],
	digest: string,
	appliedDigest: string | undefined,
): HindsightModelSettingsStatus["applyState"] {
	if (configState !== "configured") {
		return "blocked";
	}
	if (appliedDigest !== digest) {
		return "pending";
	}
	if (runtimeState === "scaled_down") {
		return "applied";
	}
	const observed = deployment.status?.observedGeneration ?? 0;
	const generation = deployment.metadata?.generation ?? 0;
	if (observed < generation) {
		return "applying";
	}
	const conditions = deployment.status?.conditions ?? [];
	if (
		conditions.some(
			(condition) =>
				(condition.type === "Progressing" && condition.status === "False") ||
				(condition.type === "ReplicaFailure" && condition.status === "True"),
		)
	) {
		return "failed";
	}
	const desired = deployment.spec?.replicas ?? 1;
	if (
		(deployment.status?.updatedReplicas ?? 0) < desired ||
		(deployment.status?.availableReplicas ?? 0) < desired
	) {
		return "applying";
	}
	return "applied";
}

function modelConfigState(data: Record<string, string>): ModelConfigState {
	const requiredKeys = [
		LLM_API_KEY,
		LLM_BASE_URL,
		LLM_MODEL,
		EMBEDDING_API_KEY,
		EMBEDDING_BASE_URL,
	];
	if (requiredKeys.some((key) => !decodeSecretValue(data[key]))) {
		return "unconfigured";
	}
	const fixedValues: Record<string, string> = {
		[LLM_PROVIDER]: "openai",
		[EMBEDDING_MODEL]: FIXED_EMBEDDING_MODEL,
		[EMBEDDING_PROVIDER]: FIXED_EMBEDDING_PROVIDER,
		[RERANKER_PROVIDER]: FIXED_RERANKER_PROVIDER,
	};
	return Object.entries(fixedValues).every(
		([key, expected]) => decodeSecretValue(data[key]) === expected,
	)
		? "configured"
		: "drifted";
}

function modelConfigDigest(data: Record<string, string>) {
	const values = [
		LLM_PROVIDER,
		LLM_API_KEY,
		LLM_BASE_URL,
		LLM_MODEL,
		EMBEDDING_API_KEY,
		EMBEDDING_BASE_URL,
		EMBEDDING_MODEL,
		EMBEDDING_PROVIDER,
		RERANKER_PROVIDER,
	].map((key) => `${key}=${data[key] ?? ""}`);
	return `sha256:${createHash("sha256").update(values.join("\n")).digest("hex")}`;
}

function encodeSecretValue(value: string) {
	return Buffer.from(value.trim(), "utf-8").toString("base64");
}

function decodeSecretValue(value: string | undefined) {
	const encoded = value?.trim();
	if (!encoded) {
		return "";
	}
	if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(encoded)) {
		return "";
	}
	try {
		return Buffer.from(encoded, "base64").toString("utf-8").trim();
	} catch {
		return "";
	}
}

function secretLast4(value: string | undefined) {
	const decoded = decodeSecretValue(value);
	return decoded ? decoded.slice(-4) : null;
}

function validIsoTimestamp(value: string | undefined): string | null {
	if (!(value && Number.isFinite(Date.parse(value)))) {
		return null;
	}
	return new Date(value).toISOString();
}

function normalizedNullable(value: string | undefined): string | null {
	return value?.trim() || null;
}

function isApiStatus(error: unknown, status: number): boolean {
	return error instanceof ApiException && error.code === status;
}

function sanitizeKubernetesError(
	error: unknown,
): HindsightModelSettingsStoreUnavailableError | HindsightModelSettingsConflictError {
	if (error instanceof HindsightModelSettingsStoreUnavailableError) {
		return error;
	}
	if (
		error instanceof HindsightModelSettingsConflictError ||
		isApiStatus(error, 409) ||
		isApiStatus(error, 422)
	) {
		return new HindsightModelSettingsConflictError();
	}
	if (isApiStatus(error, 404)) {
		return new HindsightModelSettingsStoreUnavailableError("RESOURCE_NOT_INITIALIZED");
	}
	return new HindsightModelSettingsStoreUnavailableError(
		isApiStatus(error, 403) ? "KUBERNETES_ACCESS_DENIED" : "KUBERNETES_API_UNAVAILABLE",
	);
}
