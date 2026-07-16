import { ApiException, CoreV1Api, KubeConfig, type V1Secret } from "@kubernetes/client-node";

import type { OpsInternalPortalCredentialStatus } from "../shared/ops-contract.ts";

const PORTAL_AUTH_SECRET_NAME = "source-collector-internal-portal-auth";
const PORTAL_AUTH_SECRET_KEY = "sso_tgc";
const UPDATED_AT_ANNOTATION = "campus-agent.io/portal-auth-updated-at";
const UPDATED_BY_ANNOTATION = "campus-agent.io/portal-auth-updated-by";

interface KubernetesSecretApi {
	patchNamespacedSecret(input: {
		body: unknown;
		fieldManager?: string;
		name: string;
		namespace: string;
	}): Promise<V1Secret>;
	readNamespacedSecret(input: { name: string; namespace: string }): Promise<V1Secret>;
}

export interface InternalPortalAuthStore {
	getStatus(): Promise<OpsInternalPortalCredentialStatus>;
	replaceCredential(input: {
		credential: string;
		updatedAt: string;
		updatedBy: string;
	}): Promise<OpsInternalPortalCredentialStatus>;
}

export class InternalPortalAuthStoreUnavailableError extends Error {
	readonly reasonCode: string;

	constructor(reasonCode: string) {
		super("internal portal auth store is unavailable");
		this.name = "InternalPortalAuthStoreUnavailableError";
		this.reasonCode = reasonCode;
	}
}

export function createKubernetesInternalPortalAuthStore(input?: {
	api?: KubernetesSecretApi;
	namespace?: string;
}): InternalPortalAuthStore {
	const runtime = input?.api && input.namespace ? input : createInClusterRuntime();
	if (!(runtime.api && runtime.namespace)) {
		throw new InternalPortalAuthStoreUnavailableError("KUBERNETES_CONFIG_UNAVAILABLE");
	}
	const api = runtime.api;
	const namespace = runtime.namespace;

	return {
		async getStatus() {
			try {
				return statusFromSecret(
					await api.readNamespacedSecret({
						name: PORTAL_AUTH_SECRET_NAME,
						namespace,
					}),
				);
			} catch (error) {
				if (isApiStatus(error, 404)) {
					return emptyStatus();
				}
				throw sanitizeKubernetesError(error);
			}
		},
		async replaceCredential(replacement) {
			let secret: V1Secret;
			try {
				secret = await api.readNamespacedSecret({
					name: PORTAL_AUTH_SECRET_NAME,
					namespace,
				});
			} catch (error) {
				if (isApiStatus(error, 404)) {
					throw new InternalPortalAuthStoreUnavailableError("SECRET_NOT_INITIALIZED");
				}
				throw sanitizeKubernetesError(error);
			}

			try {
				const updated = await api.patchNamespacedSecret({
					body: buildSecretPatch(secret, replacement),
					fieldManager: "ops-web",
					name: PORTAL_AUTH_SECRET_NAME,
					namespace,
				});
				return statusFromSecret(updated);
			} catch (error) {
				throw sanitizeKubernetesError(error);
			}
		},
	};
}

export function createUnavailableInternalPortalAuthStore(
	reasonCode = "KUBERNETES_CONFIG_UNAVAILABLE",
): InternalPortalAuthStore {
	const unavailable = async (): Promise<never> => {
		throw new InternalPortalAuthStoreUnavailableError(reasonCode);
	};
	return { getStatus: unavailable, replaceCredential: unavailable };
}

export function parseInternalPortalCredential(input: string): string {
	const normalized = input.trim();
	if (!normalized) {
		throw new Error("internal portal credential is empty");
	}

	const cookieValues = normalized
		.split(";")
		.map((segment) => segment.trim())
		.filter((segment) => segment.startsWith("SSO_TGC="))
		.map((segment) => segment.slice("SSO_TGC=".length).trim());
	if (cookieValues.length > 1) {
		throw new Error("internal portal credential contains multiple SSO_TGC values");
	}
	const credential = cookieValues[0] ?? normalized;
	if (!credential) {
		throw new Error("internal portal credential is empty");
	}
	for (let index = 0; index < credential.length; index += 1) {
		const code = credential.charCodeAt(index);
		if (
			code < 0x21 ||
			code > 0x7e ||
			code === 0x22 ||
			code === 0x2c ||
			code === 0x3b ||
			code === 0x5c
		) {
			throw new Error("internal portal credential contains invalid characters");
		}
	}
	return credential;
}

function createInClusterRuntime(): { api: KubernetesSecretApi; namespace: string } {
	try {
		const kubeConfig = new KubeConfig();
		kubeConfig.loadFromCluster();
		const namespace = kubeConfig
			.getContextObject(kubeConfig.getCurrentContext())
			?.namespace?.trim();
		if (!namespace) {
			throw new Error("Kubernetes namespace is unavailable");
		}
		return { api: kubeConfig.makeApiClient(CoreV1Api), namespace };
	} catch {
		throw new InternalPortalAuthStoreUnavailableError("KUBERNETES_CONFIG_UNAVAILABLE");
	}
}

function buildSecretPatch(
	secret: V1Secret,
	input: { credential: string; updatedAt: string; updatedBy: string },
) {
	const patch: Array<{ op: "add"; path: string; value: unknown }> = [];
	const encodedCredential = Buffer.from(input.credential, "utf-8").toString("base64");
	if (secret.data) {
		patch.push({ op: "add", path: `/data/${PORTAL_AUTH_SECRET_KEY}`, value: encodedCredential });
	} else {
		patch.push({
			op: "add",
			path: "/data",
			value: { [PORTAL_AUTH_SECRET_KEY]: encodedCredential },
		});
	}

	const annotations = {
		[UPDATED_AT_ANNOTATION]: input.updatedAt,
		[UPDATED_BY_ANNOTATION]: input.updatedBy,
	};
	if (secret.metadata?.annotations) {
		for (const [key, value] of Object.entries(annotations)) {
			patch.push({ op: "add", path: `/metadata/annotations/${escapeJsonPointer(key)}`, value });
		}
	} else {
		patch.push({ op: "add", path: "/metadata/annotations", value: annotations });
	}
	return patch;
}

function statusFromSecret(secret: V1Secret): OpsInternalPortalCredentialStatus {
	const annotations = secret.metadata?.annotations ?? {};
	return {
		configured: Boolean(secret.data?.[PORTAL_AUTH_SECRET_KEY]),
		updatedAt: validIsoTimestamp(annotations[UPDATED_AT_ANNOTATION]),
		updatedBy: normalizedNullable(annotations[UPDATED_BY_ANNOTATION]),
	};
}

function emptyStatus(): OpsInternalPortalCredentialStatus {
	return { configured: false, updatedAt: null, updatedBy: null };
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

function escapeJsonPointer(value: string): string {
	return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function isApiStatus(error: unknown, status: number): boolean {
	return error instanceof ApiException && error.code === status;
}

function sanitizeKubernetesError(error: unknown): InternalPortalAuthStoreUnavailableError {
	if (error instanceof InternalPortalAuthStoreUnavailableError) {
		return error;
	}
	return new InternalPortalAuthStoreUnavailableError(
		isApiStatus(error, 403) ? "KUBERNETES_ACCESS_DENIED" : "KUBERNETES_API_UNAVAILABLE",
	);
}
