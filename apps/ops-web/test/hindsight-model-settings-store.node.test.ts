// @vitest-environment node

import { ApiException, type V1Deployment, type V1Secret } from "@kubernetes/client-node";
import { describe, expect, it, vi } from "vitest";
import {
	createKubernetesHindsightModelSettingsStore,
	HindsightModelSettingsConflictError,
} from "../src/server/hindsight-model-settings-store";

const namespace = "campus-agent-staging";

describe("Hindsight model settings store", () => {
	it("preserves credentials and applies settings without replacing unrelated annotations", async () => {
		let secret = configuredSecret();
		let deployment = readyDeployment();
		const patchNamespacedSecret = vi.fn(async ({ body }: { body: unknown }) => {
			secret = applySecretPatch(secret, body);
			return secret;
		});
		const patchNamespacedDeployment = vi.fn(async ({ body }: { body: unknown }) => {
			deployment = applyDeploymentPatch(deployment, body);
			return deployment;
		});
		const store = createKubernetesHindsightModelSettingsStore({
			deploymentApi: {
				patchNamespacedDeployment,
				readNamespacedDeployment: vi.fn(async () => deployment),
			},
			namespace,
			secretApi: {
				patchNamespacedSecret,
				readNamespacedSecret: vi.fn(async () => secret),
			},
		});

		const saved = await store.replaceSettings({
			etag: "10",
			settings: {
				embedding: { apiKey: "", baseUrl: "https://embedding-next.example/v1" },
				llm: {
					apiKey: "",
					baseUrl: "https://llm-next.example/v1",
					model: "hindsight-next",
				},
			},
			updatedAt: "2026-07-21T01:00:00.000Z",
			updatedBy: "ops@example.test",
		});

		expect(saved).toMatchObject({
			applyState: "pending",
			configState: "configured",
			runtimeState: "running",
		});
		expect(saved.llm.credentialConfigured).toBe(true);
		expect(saved.embedding.credentialConfigured).toBe(true);
		expect(secret.data?.HINDSIGHT_API_LLM_DEFAULT_HEADERS).toBeUndefined();
		expect(decode(secret.data?.UNRELATED_SETTING)).toBe("preserved");
		expect(decode(secret.data?.HINDSIGHT_API_LLM_API_KEY)).toBe("llm-secret");
		expect(decode(secret.data?.HINDSIGHT_API_EMBEDDINGS_OPENAI_API_KEY)).toBe("embedding-secret");
		expect(decode(secret.data?.HINDSIGHT_API_EMBEDDINGS_OPENAI_MODEL)).toBe("Qwen3-Embedding-4B");
		expect(decode(secret.data?.HINDSIGHT_API_EMBEDDINGS_PROVIDER)).toBe("openai");
		expect(decode(secret.data?.HINDSIGHT_API_RERANKER_PROVIDER)).toBe("rrf");

		const applied = await store.apply({
			appliedAt: "2026-07-21T01:01:00.000Z",
		});
		expect(applied.applyState).toBe("applying");
		expect(patchNamespacedDeployment).toHaveBeenCalledTimes(1);
		const operations = patchNamespacedDeployment.mock.calls[0]?.[0].body as Array<{
			op: string;
			path: string;
			value?: unknown;
		}>;
		expect(operations[0]).toEqual({
			op: "test",
			path: "/metadata/resourceVersion",
			value: "20",
		});
		expect(operations.map((operation) => operation.path)).toEqual([
			"/metadata/resourceVersion",
			"/spec/template/metadata/annotations/campus-agent.io~1hindsight-model-config-digest",
			"/spec/template/metadata/annotations/campus-agent.io~1hindsight-restarted-at",
		]);
		expect(deployment.spec?.template.metadata?.annotations).toMatchObject({
			"example.com/unrelated": "preserved",
			"campus-agent.io/hindsight-model-config-digest": expect.stringMatching(/^sha256:/u),
			"campus-agent.io/hindsight-restarted-at": "2026-07-21T01:01:00.000Z",
		});
		deployment.status = {
			availableReplicas: 1,
			observedGeneration: deployment.metadata?.generation,
			updatedReplicas: 1,
		};
		expect((await store.getStatus()).applyState).toBe("applied");
	});

	it("never returns credential values", async () => {
		const secret = configuredSecret();
		const deployment = readyDeployment();
		const store = createKubernetesHindsightModelSettingsStore({
			deploymentApi: {
				patchNamespacedDeployment: vi.fn(),
				readNamespacedDeployment: vi.fn(async () => deployment),
			},
			namespace,
			secretApi: {
				patchNamespacedSecret: vi.fn(),
				readNamespacedSecret: vi.fn(async () => secret),
			},
		});
		const status = await store.getStatus();
		const serialized = JSON.stringify(status);
		expect(serialized).not.toContain("llm-secret");
		expect(serialized).not.toContain("embedding-secret");
		expect(status.llm.credentialLast4).toBe("cret");
	});

	it("reports fixed model-key drift and refuses rollout", async () => {
		const secret = configuredSecret();
		if (!secret.data) {
			throw new Error("fixture secret data is required");
		}
		secret.data.HINDSIGHT_API_EMBEDDINGS_OPENAI_MODEL = encode("text-embedding-3-small");
		const patchNamespacedDeployment = vi.fn();
		const store = createKubernetesHindsightModelSettingsStore({
			deploymentApi: {
				patchNamespacedDeployment,
				readNamespacedDeployment: vi.fn(async () => readyDeployment()),
			},
			namespace,
			secretApi: {
				patchNamespacedSecret: vi.fn(),
				readNamespacedSecret: vi.fn(async () => secret),
			},
		});

		expect(await store.getStatus()).toMatchObject({
			applyState: "blocked",
			configState: "drifted",
		});
		await expect(store.apply({ appliedAt: "2026-07-21T01:01:00.000Z" })).rejects.toMatchObject({
			reasonCode: "MODEL_CONFIG_DRIFTED",
		});
		expect(patchNamespacedDeployment).not.toHaveBeenCalled();
	});

	it("does not treat empty or malformed encoded credentials as configured", async () => {
		const secret = configuredSecret();
		if (!secret.data) {
			throw new Error("fixture secret data is required");
		}
		secret.data.HINDSIGHT_API_LLM_API_KEY = encode("   ");
		secret.data.HINDSIGHT_API_EMBEDDINGS_OPENAI_API_KEY = "not-base64";
		const store = createKubernetesHindsightModelSettingsStore({
			deploymentApi: {
				patchNamespacedDeployment: vi.fn(),
				readNamespacedDeployment: vi.fn(async () => readyDeployment()),
			},
			namespace,
			secretApi: {
				patchNamespacedSecret: vi.fn(),
				readNamespacedSecret: vi.fn(async () => secret),
			},
		});

		const status = await store.getStatus();
		expect(status.llm.credentialConfigured).toBe(false);
		expect(status.embedding.credentialConfigured).toBe(false);
		expect(status.configState).toBe("unconfigured");
		expect(status.applyState).toBe("blocked");
	});

	it("rejects a stale ETag before patching the Secret", async () => {
		const secret = configuredSecret();
		const deployment = readyDeployment();
		const patchNamespacedSecret = vi.fn();
		const store = createKubernetesHindsightModelSettingsStore({
			deploymentApi: {
				patchNamespacedDeployment: vi.fn(),
				readNamespacedDeployment: vi.fn(async () => deployment),
			},
			namespace,
			secretApi: {
				patchNamespacedSecret,
				readNamespacedSecret: vi.fn(async () => secret),
			},
		});

		await expect(
			store.replaceSettings({
				etag: "stale",
				settings: {
					embedding: { baseUrl: "https://embedding.example/v1" },
					llm: { baseUrl: "https://llm.example/v1", model: "hindsight-model" },
				},
				updatedAt: "2026-07-21T01:00:00.000Z",
				updatedBy: "ops@example.test",
			}),
		).rejects.toBeInstanceOf(HindsightModelSettingsConflictError);
		expect(patchNamespacedSecret).not.toHaveBeenCalled();
	});

	it("returns an actionable rollout failure without exposing credentials", async () => {
		const secret = configuredSecret();
		let deployment = readyDeployment();
		const store = createKubernetesHindsightModelSettingsStore({
			deploymentApi: {
				patchNamespacedDeployment: vi.fn(async ({ body }: { body: unknown }) => {
					deployment = applyDeploymentPatch(deployment, body);
					return deployment;
				}),
				readNamespacedDeployment: vi.fn(async () => deployment),
			},
			namespace,
			secretApi: {
				patchNamespacedSecret: vi.fn(),
				readNamespacedSecret: vi.fn(async () => secret),
			},
		});
		await store.apply({ appliedAt: "2026-07-21T01:01:00.000Z" });
		deployment.status = {
			conditions: [
				{
					lastTransitionTime: new Date("2026-07-21T01:02:00.000Z"),
					message: "ReplicaSet did not become available",
					reason: "ProgressDeadlineExceeded",
					status: "False",
					type: "Progressing",
				},
			],
			observedGeneration: deployment.metadata?.generation,
		};

		const status = await store.getStatus();
		expect(status.applyState).toBe("failed");
		expect(status.failure).toEqual({
			message: "ReplicaSet did not become available",
			reasonCode: "HINDSIGHT_ROLLOUT_STALLED",
		});
		expect(JSON.stringify(status.failure)).not.toContain("llm-secret");
	});

	it("ignores failure conditions from a previous Deployment generation", async () => {
		const secret = configuredSecret();
		let deployment = readyDeployment();
		deployment.status = {
			...deployment.status,
			conditions: [
				{
					message: "previous rollout failed",
					status: "True",
					type: "ReplicaFailure",
				},
			],
		};
		const store = createKubernetesHindsightModelSettingsStore({
			deploymentApi: {
				patchNamespacedDeployment: vi.fn(async ({ body }: { body: unknown }) => {
					deployment = applyDeploymentPatch(deployment, body);
					return deployment;
				}),
				readNamespacedDeployment: vi.fn(async () => deployment),
			},
			namespace,
			secretApi: {
				patchNamespacedSecret: vi.fn(),
				readNamespacedSecret: vi.fn(async () => secret),
			},
		});

		expect((await store.apply({ appliedAt: "2026-07-21T01:01:00.000Z" })).applyState).toBe(
			"applying",
		);
		deployment.status = {
			...deployment.status,
			observedGeneration: deployment.metadata?.generation,
		};
		expect((await store.getStatus()).applyState).toBe("failed");
	});

	it("reports zero replicas separately and prepares the next start", async () => {
		const secret = configuredSecret();
		let deployment = readyDeployment();
		if (!deployment.spec) {
			throw new Error("deployment spec is required by the fixture");
		}
		deployment.spec.replicas = 0;
		deployment.spec.template.metadata = {};
		deployment.status = {
			conditions: [
				{
					message: "stale rollout failure",
					status: "True",
					type: "ReplicaFailure",
				},
			],
		};
		const patchNamespacedDeployment = vi.fn(async ({ body }: { body: unknown }) => {
			deployment = applyDeploymentPatch(deployment, body);
			return deployment;
		});
		const store = createKubernetesHindsightModelSettingsStore({
			deploymentApi: {
				patchNamespacedDeployment,
				readNamespacedDeployment: vi.fn(async () => deployment),
			},
			namespace,
			secretApi: {
				patchNamespacedSecret: vi.fn(),
				readNamespacedSecret: vi.fn(async () => secret),
			},
		});

		expect(await store.getStatus()).toMatchObject({
			applyState: "pending",
			failure: null,
			runtimeState: "scaled_down",
		});
		const applied = await store.apply({ appliedAt: "2026-07-21T01:01:00.000Z" });
		expect(applied).toMatchObject({
			applyState: "applied",
			failure: null,
			runtimeState: "scaled_down",
		});
		const operations = patchNamespacedDeployment.mock.calls[0]?.[0].body as Array<{
			op: string;
			path: string;
			value?: unknown;
		}>;
		expect(operations[1]).toEqual({
			op: "add",
			path: "/spec/template/metadata/annotations",
			value: {},
		});
	});

	it("fails closed when Deployment resourceVersion is missing", async () => {
		const deployment = readyDeployment();
		if (deployment.metadata) {
			delete deployment.metadata.resourceVersion;
		}
		const patchNamespacedDeployment = vi.fn();
		const store = createKubernetesHindsightModelSettingsStore({
			deploymentApi: {
				patchNamespacedDeployment,
				readNamespacedDeployment: vi.fn(async () => deployment),
			},
			namespace,
			secretApi: {
				patchNamespacedSecret: vi.fn(),
				readNamespacedSecret: vi.fn(async () => configuredSecret()),
			},
		});

		await expect(store.apply({ appliedAt: "2026-07-21T01:01:00.000Z" })).rejects.toMatchObject({
			reasonCode: "KUBERNETES_RESOURCE_VERSION_MISSING",
		});
		expect(patchNamespacedDeployment).not.toHaveBeenCalled();
	});

	it("maps Kubernetes patch conflicts without exposing the response body", async () => {
		const upstream = new ApiException(409, "secret upstream body", {}, {});
		const store = createKubernetesHindsightModelSettingsStore({
			deploymentApi: {
				patchNamespacedDeployment: vi.fn(async () => {
					throw upstream;
				}),
				readNamespacedDeployment: vi.fn(async () => readyDeployment()),
			},
			namespace,
			secretApi: {
				patchNamespacedSecret: vi.fn(),
				readNamespacedSecret: vi.fn(async () => configuredSecret()),
			},
		});

		await expect(store.apply({ appliedAt: "2026-07-21T01:01:00.000Z" })).rejects.toBeInstanceOf(
			HindsightModelSettingsConflictError,
		);
	});
});

function configuredSecret(): V1Secret {
	return {
		data: {
			HINDSIGHT_API_EMBEDDINGS_OPENAI_API_KEY: encode("embedding-secret"),
			HINDSIGHT_API_EMBEDDINGS_OPENAI_BASE_URL: encode("https://embedding.example/v1"),
			HINDSIGHT_API_LLM_API_KEY: encode("llm-secret"),
			HINDSIGHT_API_LLM_BASE_URL: encode("https://llm.example/v1"),
			HINDSIGHT_API_LLM_DEFAULT_HEADERS: encode('{"x-provider":"legacy"}'),
			HINDSIGHT_API_LLM_MODEL: encode("hindsight-model"),
			HINDSIGHT_API_LLM_PROVIDER: encode("openai"),
			HINDSIGHT_API_EMBEDDINGS_OPENAI_MODEL: encode("Qwen3-Embedding-4B"),
			HINDSIGHT_API_EMBEDDINGS_PROVIDER: encode("openai"),
			HINDSIGHT_API_RERANKER_PROVIDER: encode("rrf"),
			UNRELATED_SETTING: encode("preserved"),
		},
		metadata: {
			annotations: {},
			name: "hindsight-model-config",
			namespace,
			resourceVersion: "10",
		},
	};
}

function readyDeployment(): V1Deployment {
	return {
		metadata: {
			generation: 1,
			name: "hindsight-api",
			namespace,
			resourceVersion: "20",
		},
		spec: {
			replicas: 1,
			selector: { matchLabels: { app: "hindsight" } },
			template: { metadata: { annotations: { "example.com/unrelated": "preserved" } } },
		},
		status: { availableReplicas: 1, observedGeneration: 1, updatedReplicas: 1 },
	};
}

function applySecretPatch(current: V1Secret, body: unknown): V1Secret {
	const operations = body as Array<{ op: string; path: string; value?: unknown }>;
	const data = { ...(current.data ?? {}) };
	for (const operation of operations) {
		if (!operation.path.startsWith("/data/")) {
			continue;
		}
		const key = operation.path.slice("/data/".length);
		if (operation.op === "remove") {
			delete data[key];
		} else if (typeof operation.value === "string") {
			data[key] = operation.value;
		}
	}
	return {
		...current,
		data,
		metadata: {
			...current.metadata,
			annotations: operations.find((operation) => operation.path === "/metadata/annotations")
				?.value as Record<string, string>,
		},
	};
}

function applyDeploymentPatch(current: V1Deployment, body: unknown): V1Deployment {
	if (!current.spec) {
		throw new Error("deployment spec is required by the fixture");
	}
	const spec = current.spec;
	const operations = body as Array<{ op: string; path: string; value?: unknown }>;
	const resourceVersionTest = operations[0];
	if (
		resourceVersionTest?.op !== "test" ||
		resourceVersionTest.path !== "/metadata/resourceVersion" ||
		resourceVersionTest.value !== current.metadata?.resourceVersion
	) {
		throw new Error("deployment patch must test the current resourceVersion first");
	}
	let templateMetadata = spec.template.metadata
		? {
				...spec.template.metadata,
				annotations: spec.template.metadata.annotations
					? { ...spec.template.metadata.annotations }
					: undefined,
			}
		: undefined;
	for (const operation of operations.slice(1)) {
		if (operation.op !== "add") {
			throw new Error(`unsupported deployment patch operation: ${operation.op}`);
		}
		if (operation.path === "/spec/template/metadata") {
			templateMetadata = operation.value as typeof templateMetadata;
			continue;
		}
		if (operation.path === "/spec/template/metadata/annotations") {
			templateMetadata = {
				...(templateMetadata ?? {}),
				annotations: operation.value as Record<string, string>,
			};
			continue;
		}
		const prefix = "/spec/template/metadata/annotations/";
		if (!operation.path.startsWith(prefix) || typeof operation.value !== "string") {
			throw new Error(`unsupported deployment patch path: ${operation.path}`);
		}
		const key = operation.path.slice(prefix.length).replaceAll("~1", "/").replaceAll("~0", "~");
		templateMetadata = {
			...(templateMetadata ?? {}),
			annotations: {
				...(templateMetadata?.annotations ?? {}),
				[key]: operation.value,
			},
		};
	}
	return {
		...current,
		metadata: {
			...current.metadata,
			generation: (current.metadata?.generation ?? 0) + 1,
			resourceVersion: String(Number(current.metadata?.resourceVersion ?? "0") + 1),
		},
		spec: {
			...spec,
			template: {
				...spec.template,
				metadata: templateMetadata,
			},
		},
	};
}

function encode(value: string) {
	return Buffer.from(value, "utf-8").toString("base64");
}

function decode(value: string | undefined) {
	return Buffer.from(value ?? "", "base64").toString("utf-8");
}
