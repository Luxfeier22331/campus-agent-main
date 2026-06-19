// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
	buildProviderConfigService,
	createInMemoryProviderConfigStore,
} from "../src/modules/provider-config";
import { createOperatorPrincipal } from "./operator-query.route.test-support";

describe("provider config service", () => {
	it("passes connection and profile fields to embedding compatibility checks", async () => {
		let compatibilityInput: unknown = null;
		const service = buildProviderConfigService({
			decryptSecret: (value) => value,
			encryptSecret: (value) => value,
			generateId: (prefix) => `${prefix}_embedding`,
			now: () => new Date("2026-06-16T00:00:00.000Z"),
			store: createInMemoryProviderConfigStore(),
			validators: {
				async checkEmbeddingCompatibility(input) {
					compatibilityInput = input;
					return { ok: true };
				},
				async validateEmbedding() {
					return {
						message: "embedding provider validated",
						ok: true,
						observedDimensions: 2560,
						status: "passed",
					};
				},
			},
		});
		const createdConnection = await service.createConnection({
			payload: {
				apiKey: "gitee-secret-1234",
				baseUrl: "https://ai.gitee.com/v1",
				capabilities: ["embedding"],
				capabilityConfig: {},
				provider: "gitee",
			},
			principal: createOperatorPrincipal(),
		});
		const createdProfile = await service.createProfile({
			payload: {
				connectionId: createdConnection.connection.connectionId,
				dimensions: 2560,
				kind: "embedding",
				model: "Qwen3-Embedding-4B",
				role: "rag_query_embedding",
				timeoutMs: 30000,
				transport: "embeddings",
			},
			principal: createOperatorPrincipal(),
		});
		const profileId = createdProfile.profile.profileId;
		await service.validateProfile({
			principal: createOperatorPrincipal(),
			profileId,
		});
		await service.activateProfile({
			principal: createOperatorPrincipal(),
			profileId,
		});

		expect(compatibilityInput).toMatchObject({
			apiKey: "gitee-secret-1234",
			baseUrl: "https://ai.gitee.com/v1",
			dimensions: 2560,
			model: "Qwen3-Embedding-4B",
			provider: "gitee",
			role: "rag_query_embedding",
			timeoutMs: 30000,
			transport: "embeddings",
		});
	});

	it("resolves rerank runtime snapshots through reusable provider connections", async () => {
		const service = buildProviderConfigService({
			decryptSecret: (value) => value,
			encryptSecret: (value) => value,
			generateId: (prefix) => `${prefix}_gitee`,
			now: () => new Date("2026-06-16T00:00:00.000Z"),
			store: createInMemoryProviderConfigStore(),
			validators: {
				async validateRerank() {
					return {
						message: "rerank provider validated",
						ok: true,
						status: "passed",
					};
				},
			},
		});
		const createdConnection = await service.createConnection({
			payload: {
				apiKey: "gitee-secret-1234",
				baseUrl: "https://ai.gitee.com/v1",
				capabilities: ["embedding", "rerank"],
				capabilityConfig: { rerank: { path: "/rerank" } },
				provider: "gitee",
			},
			principal: createOperatorPrincipal(),
		});
		const renderedConnection = JSON.stringify(createdConnection);

		expect(renderedConnection).not.toContain("gitee-secret-1234");
		expect(createdConnection.connection).toMatchObject({
			baseUrl: "https://ai.gitee.com/v1",
			capabilities: ["embedding", "rerank"],
			provider: "gitee",
			secretLast4: "1234",
		});

		const createdProfile = await service.createProfile({
			payload: {
				connectionId: createdConnection.connection.connectionId,
				kind: "rerank",
				model: "Qwen3-Reranker",
				role: "rag_reranker",
				timeoutMs: 30000,
				transport: "gitee_rerank",
			},
			principal: createOperatorPrincipal(),
		});
		const profileId = createdProfile.profile.profileId;
		await service.validateProfile({
			principal: createOperatorPrincipal(),
			profileId,
		});
		await service.activateProfile({
			principal: createOperatorPrincipal(),
			profileId,
		});

		await expect(service.getActiveRuntimeSnapshot({ role: "rag_reranker" })).resolves.toMatchObject(
			{
				profile: {
					api_key: "gitee-secret-1234",
					base_url: "https://ai.gitee.com/v1",
					capability_config: { rerank: { path: "/rerank" } },
					kind: "rerank",
					model: "Qwen3-Reranker",
					provider: "gitee",
					role: "rag_reranker",
					transport: "gitee_rerank",
				},
			},
		);
	});

	it("rejects retired memory graph prompt role", async () => {
		const service = buildProviderConfigService({
			decryptSecret: (value) => value,
			encryptSecret: (value) => value,
			generateId: () => "provider_profile_memory_graph",
			now: () => new Date("2026-06-16T00:00:00.000Z"),
			store: createInMemoryProviderConfigStore(),
			validators: {
				async validatePrompt() {
					return {
						message: "prompt provider validated",
						ok: true,
						status: "passed",
					};
				},
			},
		});
		await expect(
			service.createProfile({
				payload: {
					apiKey: "memory-graph-key",
					baseUrl: "https://llm-gateway.example/v1",
					kind: "prompt",
					model: "memory-graph-model",
					provider: "openai",
					role: "memory_graph_llm",
					timeoutMs: 30000,
					transport: "responses",
				},
				principal: createOperatorPrincipal(),
			}),
		).rejects.toMatchObject({ code: "validation_failed" });
	});

	it("fails closed when embedding compatibility checker is not configured", async () => {
		const service = buildProviderConfigService({
			decryptSecret: (value) => value,
			encryptSecret: (value) => value,
			generateId: () => "provider_profile_embedding",
			now: () => new Date("2026-06-16T00:00:00.000Z"),
			store: createInMemoryProviderConfigStore(),
			validators: {
				async validateEmbedding() {
					return {
						message: "embedding provider validated",
						observedDimensions: 2560,
						ok: true,
						status: "passed",
					};
				},
			},
		});
		const createdConnection = await service.createConnection({
			payload: {
				apiKey: "embedding-key",
				baseUrl: "https://embedding.example/v1",
				capabilities: ["embedding"],
				provider: "openai",
			},
			principal: createOperatorPrincipal(),
		});
		await service.createProfile({
			payload: {
				connectionId: createdConnection.connection.connectionId,
				dimensions: 2560,
				kind: "embedding",
				model: "embedding-model",
				role: "rag_query_embedding",
				timeoutMs: 30000,
				transport: "embeddings",
			},
			principal: createOperatorPrincipal(),
		});
		await service.validateProfile({
			principal: createOperatorPrincipal(),
			profileId: "provider_profile_embedding",
		});

		await expect(
			service.activateProfile({
				principal: createOperatorPrincipal(),
				profileId: "provider_profile_embedding",
			}),
		).rejects.toMatchObject({
			code: "embedding_profile_incompatible",
		});
	});
});
