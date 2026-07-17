// @vitest-environment node

import type {
	ProviderConfigConnection,
	ProviderConfigProfile,
	ProviderConfigProjection,
	ProviderConfigStore,
} from "@campus-agent/provider-config";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProviderConfigService } from "../src/server/provider-config-service.ts";

const actor = { displayName: "Operator", principalId: "operator-1" };

afterEach(() => vi.unstubAllGlobals());

describe("provider config service", () => {
	it("validates plain-text prompt responses, publishes actor provenance, and freezes active records", async () => {
		const store = memoryStore();
		let projection: ProviderConfigProjection | null = null;
		const publisher = {
			publish: vi.fn(async (value: ProviderConfigProjection) => {
				projection = structuredClone(value);
				return publicationStatus(value);
			}),
			read: vi.fn(async () =>
				projection ? { projection, status: publicationStatus(projection) } : null,
			),
			verifyReadiness: vi.fn(async () => undefined),
		};
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("OK", { status: 200 })),
		);
		const service = createProviderConfigService({
			compatibility: { check: vi.fn(async () => ({ ok: true, reason: "" })) },
			encryptionKey: "test-encryption-key",
			publisher,
			store,
		});
		const { connection } = await service.createConnection(
			{
				apiKey: "provider-key",
				baseUrl: "https://provider.example/v1",
				featureConfig: {},
				features: ["prompt"],
				provider: "openai-compatible",
			},
			actor,
		);
		const { profile } = await service.createProfile(
			{
				connectionId: connection.connectionId,
				kind: "prompt",
				model: "model",
				role: "primary_agent",
				timeoutMs: 10_000,
				transport: "responses",
			},
			actor,
		);

		await expect(service.validate(profile.profileId, actor)).resolves.toMatchObject({
			profile: { status: "validated", validation: { ok: true } },
		});
		await service.activate(profile.profileId, actor);

		expect(publisher.publish).toHaveBeenCalledWith(
			expect.objectContaining({ published_by: actor }),
		);
		await expect(
			service.updateProfile(profile.profileId, { model: "other" }, actor),
		).rejects.toMatchObject({
			code: "active_provider_profile_immutable",
		});
		await expect(
			service.updateConnection(
				connection.connectionId,
				{ baseUrl: "https://other.example/v1" },
				actor,
			),
		).rejects.toMatchObject({
			code: "active_provider_connection_immutable",
		});
	});

	it("checks embedding dimensions and all readiness dependencies", async () => {
		const store = memoryStore();
		const publisher = {
			publish: vi.fn(),
			read: vi.fn(async () => null),
			verifyReadiness: vi.fn(async () => undefined),
		};
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json({ data: [{ embedding: [1, 2] }] })),
		);
		const service = createProviderConfigService({
			compatibility: { check: vi.fn(async () => ({ ok: true, reason: "" })) },
			encryptionKey: "test-encryption-key",
			publisher,
			store,
		});
		const { connection } = await service.createConnection(
			{
				apiKey: "provider-key",
				baseUrl: "https://provider.example/v1",
				features: ["embedding"],
				provider: "openai-compatible",
			},
			actor,
		);
		const { profile } = await service.createProfile(
			{
				connectionId: connection.connectionId,
				dimensions: 3,
				kind: "embedding",
				model: "embedding-model",
				role: "rag_query_embedding",
				timeoutMs: 10_000,
				transport: "embeddings",
			},
			actor,
		);

		await expect(service.validate(profile.profileId, actor)).resolves.toMatchObject({
			profile: {
				status: "validation_failed",
				validation: { errorCode: "embedding_dimensions_mismatch" },
			},
		});
		await expect(service.verifyReadiness()).resolves.toBeUndefined();
		expect(store.verifyReadiness).toHaveBeenCalledOnce();
		expect(publisher.verifyReadiness).toHaveBeenCalledOnce();
	});
});

function memoryStore(): ProviderConfigStore {
	const connections = new Map<string, ProviderConfigConnection>();
	const profiles = new Map<string, ProviderConfigProfile>();
	return {
		getConnection: async (id) => structuredClone(connections.get(id) ?? null),
		getProfile: async (id) => structuredClone(profiles.get(id) ?? null),
		listConnections: async () => structuredClone([...connections.values()]),
		listProfiles: async () => structuredClone([...profiles.values()]),
		saveConnection: async (value) => {
			connections.set(value.connectionId, structuredClone(value));
		},
		saveProfile: async (value) => {
			profiles.set(value.profileId, structuredClone(value));
		},
		verifyReadiness: vi.fn(async () => undefined),
	};
}

function publicationStatus(value: ProviderConfigProjection) {
	return {
		configured: true,
		digest: "sha256:test",
		profiles: Object.fromEntries(
			Object.entries(value.profiles).map(([role, profile]) => [
				role,
				{
					model: profile.model,
					profileId: profile.profile_id,
					provider: profile.provider,
					revision: profile.revision,
				},
			]),
		),
		publicationId: value.publication_id,
		publishedAt: value.published_at,
		publishedBy: value.published_by,
	};
}
