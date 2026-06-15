// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
	buildProviderConfigService,
	createInMemoryProviderConfigStore,
} from "../src/modules/provider-config";
import { createOperatorPrincipal } from "./operator-query.route.test-support";

describe("provider config service", () => {
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
		await service.createProfile({
			payload: {
				apiKey: "embedding-key",
				baseUrl: "https://embedding.example/v1",
				dimensions: 2560,
				kind: "embedding",
				model: "embedding-model",
				provider: "openai",
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
