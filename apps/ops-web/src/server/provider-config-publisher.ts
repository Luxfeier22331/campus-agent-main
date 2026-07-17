import { constants } from "node:fs";
import { access, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
	canonicalProjectionBytes,
	type ProviderConfigProjection,
	parseProviderConfigProjection,
	projectionDigest,
} from "@campus-agent/provider-config";
import { ApiException, CoreV1Api, KubeConfig, type V1Secret } from "@kubernetes/client-node";

const SECRET_NAME = "execution-runtime-provider-config";
const SECRET_KEY = "provider-config-projection.json";
const DIGEST_ANNOTATION = "campus-agent.io/provider-config-sha256";
const PUBLICATION_ANNOTATION = "campus-agent.io/provider-config-publication-id";

export interface ProviderConfigPublicationStatus {
	configured: boolean;
	digest: string | null;
	publicationId: string | null;
	profiles: Record<
		string,
		{ model: string; profileId: string; provider: string; revision: number }
	>;
	publishedAt: string | null;
	publishedBy: { displayName: string; principalId: string } | null;
}
export interface ProviderConfigPublisher {
	publish(value: ProviderConfigProjection): Promise<ProviderConfigPublicationStatus>;
	read(): Promise<{
		projection: ProviderConfigProjection;
		status: ProviderConfigPublicationStatus;
	} | null>;
	verifyReadiness(): Promise<void>;
}
export interface ProviderConfigPublisherEnv {
	OPS_WEB_PROVIDER_CONFIG_PROJECTION_PATH?: string;
	OPS_WEB_PROVIDER_CONFIG_PUBLISH_TARGET?: string;
}

export function createProviderConfigPublisherFromEnv(
	env: ProviderConfigPublisherEnv,
): ProviderConfigPublisher {
	const target = env.OPS_WEB_PROVIDER_CONFIG_PUBLISH_TARGET?.trim();
	if (target === "file") {
		const path = env.OPS_WEB_PROVIDER_CONFIG_PROJECTION_PATH?.trim();
		if (!path) {
			throw new Error("OPS_WEB_PROVIDER_CONFIG_PROJECTION_PATH is required for file target");
		}
		return createFileProviderConfigPublisher(path);
	}
	if (target === "kubernetes") {
		return createKubernetesProviderConfigPublisher();
	}
	throw new Error("OPS_WEB_PROVIDER_CONFIG_PUBLISH_TARGET must be file or kubernetes");
}

export function createFileProviderConfigPublisher(path: string): ProviderConfigPublisher {
	const filePath = resolve(path);
	return {
		async publish(value) {
			await mkdir(dirname(filePath), { mode: 0o700, recursive: true });
			const bytes = canonicalProjectionBytes(value);
			const temporary = `${filePath}.tmp-${process.pid}`;
			const handle = await open(temporary, "wx", 0o600);
			try {
				await handle.writeFile(bytes);
				await handle.close();
				await rename(temporary, filePath);
			} catch (error) {
				await handle.close().catch(() => undefined);
				await rm(temporary, { force: true }).catch(() => undefined);
				throw error;
			}
			return status(value, projectionDigest(bytes));
		},
		async read() {
			try {
				const bytes = await readFile(filePath);
				const projection = parseProjection(bytes);
				return { projection, status: status(projection, projectionDigest(bytes)) };
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") {
					return null;
				}
				throw error;
			}
		},
		async verifyReadiness() {
			await mkdir(dirname(filePath), { mode: 0o700, recursive: true });
			await access(dirname(filePath), constants.R_OK | constants.W_OK);
		},
	};
}

interface SecretApi {
	patchNamespacedSecret(input: {
		body: JsonPatchOperation[];
		fieldManager?: string;
		name: string;
		namespace: string;
	}): Promise<V1Secret>;
	readNamespacedSecret(input: { name: string; namespace: string }): Promise<V1Secret>;
}

type JsonPatchOperation =
	| { op: "add"; path: string; value: unknown }
	| { op: "test"; path: string; value: unknown };

export function createKubernetesProviderConfigPublisher(input?: {
	api: SecretApi;
	namespace: string;
}): ProviderConfigPublisher {
	const runtime = input ?? inClusterRuntime();
	return {
		async publish(value) {
			const current = await readSecret(runtime.api, runtime.namespace);
			const resourceVersion = current.metadata?.resourceVersion;
			if (!resourceVersion) {
				throw new Error("provider config Secret resourceVersion is unavailable");
			}
			const bytes = canonicalProjectionBytes(value);
			const digest = projectionDigest(bytes);
			const annotations = current.metadata?.annotations ?? {};
			const patch: JsonPatchOperation[] = [
				{ op: "test", path: "/metadata/resourceVersion", value: resourceVersion },
				{
					op: "add",
					path: "/metadata/annotations",
					value: {
						...annotations,
						[DIGEST_ANNOTATION]: digest,
						[PUBLICATION_ANNOTATION]: value.publication_id,
					},
				},
				{
					op: "add",
					path: "/data",
					value: {
						...(current.data ?? {}),
						[SECRET_KEY]: Buffer.from(bytes).toString("base64"),
					},
				},
			];
			try {
				await runtime.api.patchNamespacedSecret({
					body: patch,
					fieldManager: "ops-web-provider-config",
					name: SECRET_NAME,
					namespace: runtime.namespace,
				});
			} catch (error) {
				throw sanitize(error);
			}
			const verified = await readSecret(runtime.api, runtime.namespace);
			const encoded = verified.data?.[SECRET_KEY];
			if (!encoded || projectionDigest(Buffer.from(encoded, "base64")) !== digest) {
				throw new Error("provider config Secret write verification failed");
			}
			return status(value, digest);
		},
		async read() {
			const secret = await readSecret(runtime.api, runtime.namespace);
			const encoded = secret.data?.[SECRET_KEY];
			if (!encoded) {
				return null;
			}
			const bytes = Buffer.from(encoded, "base64");
			const projection = parseProjection(bytes);
			return { projection, status: status(projection, projectionDigest(bytes)) };
		},
		async verifyReadiness() {
			await readSecret(runtime.api, runtime.namespace);
		},
	};
}

function parseProjection(bytes: Uint8Array): ProviderConfigProjection {
	return parseProviderConfigProjection(JSON.parse(new TextDecoder().decode(bytes)));
}
function status(value: ProviderConfigProjection, digest: string): ProviderConfigPublicationStatus {
	return {
		configured: true,
		digest,
		publicationId: value.publication_id,
		profiles: Object.fromEntries(
			Object.entries(value.profiles).map(([role, item]) => [
				role,
				{
					model: item.model,
					profileId: item.profile_id,
					provider: item.provider,
					revision: item.revision,
				},
			]),
		),
		publishedAt: value.published_at,
		publishedBy: structuredClone(value.published_by),
	};
}
function inClusterRuntime(): { api: SecretApi; namespace: string } {
	const config = new KubeConfig();
	config.loadFromCluster();
	const namespace = config.getContextObject(config.getCurrentContext())?.namespace?.trim();
	if (!namespace) {
		throw new Error("Kubernetes namespace is unavailable");
	}
	return { api: config.makeApiClient(CoreV1Api), namespace };
}
async function readSecret(api: SecretApi, namespace: string): Promise<V1Secret> {
	try {
		return await api.readNamespacedSecret({ name: SECRET_NAME, namespace });
	} catch (error) {
		throw sanitize(error);
	}
}
function sanitize(error: unknown): Error {
	if (error instanceof ApiException && error.code === 404) {
		return new Error(`${SECRET_NAME} is not initialized`);
	}
	if (error instanceof ApiException && error.code === 409) {
		return new Error("provider config publication conflicted; retry");
	}
	if (error instanceof ApiException && error.code === 403) {
		return new Error("provider config Secret access denied");
	}
	return new Error("provider config Secret is unavailable");
}
