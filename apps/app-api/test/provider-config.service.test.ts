// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
	buildProviderConfigService,
	createInMemoryProviderConfigStore,
} from "../src/modules/provider-config";
import { defaultValidatePromptProvider } from "../src/modules/provider-config/validators";
import { createOperatorPrincipal } from "./operator-query.route.test-support";

describe("provider config service", () => {
	it("validates responses prompt providers by strict structured output text", async () => {
		const observedRequests: Array<{ body: unknown; url: string }> = [];
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async (input, init) => {
			observedRequests.push({
				body: init?.body ? JSON.parse(String(init.body)) : null,
				url: String(input),
			});
			return new Response(
				JSON.stringify({
					output: [
						{
							content: [{ text: '{"status":"ok"}', type: "output_text" }],
							role: "assistant",
							status: "completed",
							type: "message",
						},
					],
					status: "completed",
				}),
				{ headers: { "content-type": "application/json" }, status: 200 },
			);
		}) as typeof fetch;
		try {
			await expect(
				defaultValidatePromptProvider({
					apiKey: "provider-key",
					baseUrl: "https://provider.example/v1",
					dimensions: null,
					featureConfig: {},
					model: "gpt-compatible",
					provider: "openai-compatible",
					role: "primary_agent",
					timeoutMs: 30000,
					transport: "responses",
				}),
			).resolves.toMatchObject({
				ok: true,
				status: "passed",
			});
			expect(observedRequests).toEqual([
				{
					body: {
						input: "provider config validation",
						max_output_tokens: 128,
						model: "gpt-compatible",
						text: {
							format: {
								name: "provider_config_validation",
								schema: {
									additionalProperties: false,
									properties: { status: { const: "ok", type: "string" } },
									required: ["status"],
									type: "object",
								},
								strict: true,
								type: "json_schema",
							},
						},
					},
					url: "https://provider.example/v1/responses",
				},
			]);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("rejects responses prompt providers that ignore structured output format", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify({
					output: [
						{
							content: [{ text: "ok", type: "output_text" }],
							role: "assistant",
							status: "completed",
							type: "message",
						},
					],
					status: "completed",
				}),
				{ headers: { "content-type": "application/json" }, status: 200 },
			)) as typeof fetch;
		try {
			await expect(
				defaultValidatePromptProvider({
					apiKey: "provider-key",
					baseUrl: "https://provider.example/v1",
					dimensions: null,
					featureConfig: {},
					model: "gpt-compatible",
					provider: "openai-compatible",
					role: "primary_agent",
					timeoutMs: 30000,
					transport: "responses",
				}),
			).resolves.toMatchObject({
				errorCode: "prompt_response_shape_invalid",
				ok: false,
				status: "failed",
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("rejects responses prompt providers that omit SDK-required output item status", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify({
					output: [
						{
							content: [{ text: '{"status":"ok"}', type: "output_text" }],
							role: "assistant",
							type: "message",
						},
					],
					status: "completed",
				}),
				{ headers: { "content-type": "application/json" }, status: 200 },
			)) as typeof fetch;
		try {
			await expect(
				defaultValidatePromptProvider({
					apiKey: "provider-key",
					baseUrl: "https://provider.example/v1",
					dimensions: null,
					featureConfig: {},
					model: "gpt-compatible",
					provider: "openai-compatible",
					role: "primary_agent",
					timeoutMs: 30000,
					transport: "responses",
				}),
			).resolves.toMatchObject({
				errorCode: "prompt_response_shape_invalid",
				ok: false,
				status: "failed",
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("rejects chat-completions prompt providers that ignore structured response format", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify({
					choices: [{ message: { content: "ok", role: "assistant" } }],
					id: "chatcmpl_unstructured",
				}),
				{ headers: { "content-type": "application/json" }, status: 200 },
			)) as typeof fetch;
		try {
			await expect(
				defaultValidatePromptProvider({
					apiKey: "provider-key",
					baseUrl: "https://provider.example/v1",
					dimensions: null,
					featureConfig: {},
					model: "gpt-compatible",
					provider: "openai-compatible",
					role: "primary_agent",
					timeoutMs: 30000,
					transport: "chat_completions",
				}),
			).resolves.toMatchObject({
				errorCode: "prompt_response_shape_invalid",
				ok: false,
				status: "failed",
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("validates chat-completions prompt providers by strict structured message shape", async () => {
		const observedRequests: Array<{ body: unknown; url: string }> = [];
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async (input, init) => {
			observedRequests.push({
				body: init?.body ? JSON.parse(String(init.body)) : null,
				url: String(input),
			});
			return new Response(
				JSON.stringify({
					choices: [
						{
							message: {
								content: '{"kind":"answer","answerText":"provider config validation"}',
								role: "assistant",
							},
						},
					],
					id: "chatcmpl_compatible",
				}),
				{ headers: { "content-type": "application/json" }, status: 200 },
			);
		}) as typeof fetch;
		try {
			await expect(
				defaultValidatePromptProvider({
					apiKey: "provider-key",
					baseUrl: "https://provider.example/v1",
					dimensions: null,
					featureConfig: {},
					model: "gpt-compatible",
					provider: "openai-compatible",
					role: "primary_agent",
					timeoutMs: 30000,
					transport: "chat_completions",
				}),
			).resolves.toMatchObject({
				ok: true,
				status: "passed",
			});
			expect(observedRequests).toEqual([
				{
					body: {
						max_tokens: 64,
						messages: [
							{
								content: "Return a short JSON answer matching the schema.",
								role: "system",
							},
							{ content: "provider config validation", role: "user" },
						],
						model: "gpt-compatible",
						response_format: {
							json_schema: {
								name: "output",
								schema: {
									$schema: "http://json-schema.org/draft-07/schema#",
									additionalProperties: false,
									properties: {
										answerText: { minLength: 1, type: "string" },
										kind: { const: "answer", type: "string" },
									},
									required: ["kind", "answerText"],
									type: "object",
								},
								strict: true,
							},
							type: "json_schema",
						},
					},
					url: "https://provider.example/v1/chat/completions",
				},
			]);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

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
				features: ["embedding"],
				featureConfig: {},
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

	it("resolves rerank projection snapshots through reusable provider connections", async () => {
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
				features: ["embedding", "rerank"],
				featureConfig: { rerank: { path: "/rerank" } },
				provider: "gitee",
			},
			principal: createOperatorPrincipal(),
		});
		const renderedConnection = JSON.stringify(createdConnection);

		expect(renderedConnection).not.toContain("gitee-secret-1234");
		expect(createdConnection.connection).toMatchObject({
			baseUrl: "https://ai.gitee.com/v1",
			features: ["embedding", "rerank"],
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
					feature_config: { rerank: { path: "/rerank" } },
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
				features: ["embedding"],
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

	it("activates Hindsight embedding profiles without RAG index compatibility checks", async () => {
		let compatibilityChecks = 0;
		const service = buildProviderConfigService({
			decryptSecret: (value) => value,
			encryptSecret: (value) => value,
			generateId: (prefix) => `${prefix}_hindsight_embedding`,
			now: () => new Date("2026-06-16T00:00:00.000Z"),
			store: createInMemoryProviderConfigStore(),
			validators: {
				async checkEmbeddingCompatibility() {
					compatibilityChecks += 1;
					return { ok: false, reason: "rag index compatibility must not gate Hindsight" };
				},
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
				apiKey: "hindsight-embedding-key",
				baseUrl: "https://embedding.example/v1",
				features: ["embedding"],
				provider: "openai-compatible",
			},
			principal: createOperatorPrincipal(),
		});
		const createdProfile = await service.createProfile({
			payload: {
				connectionId: createdConnection.connection.connectionId,
				dimensions: 2560,
				kind: "embedding",
				model: "Qwen3-Embedding-4B",
				role: "hindsight_embedding",
				timeoutMs: 30000,
				transport: "embeddings",
			},
			principal: createOperatorPrincipal(),
		});
		await service.validateProfile({
			principal: createOperatorPrincipal(),
			profileId: createdProfile.profile.profileId,
		});

		await expect(
			service.activateProfile({
				principal: createOperatorPrincipal(),
				profileId: createdProfile.profile.profileId,
			}),
		).resolves.toMatchObject({
			profile: {
				active: true,
				role: "hindsight_embedding",
				status: "active",
			},
		});
		expect(compatibilityChecks).toBe(0);
	});

	it("activates eval embedding profiles without RAG index compatibility checks", async () => {
		let compatibilityChecks = 0;
		const service = buildProviderConfigService({
			decryptSecret: (value) => value,
			encryptSecret: (value) => value,
			generateId: (prefix) => `${prefix}_eval_embedding`,
			now: () => new Date("2026-06-16T00:00:00.000Z"),
			store: createInMemoryProviderConfigStore(),
			validators: {
				async checkEmbeddingCompatibility() {
					compatibilityChecks += 1;
					return { ok: false, reason: "eval embedding must not gate on serving indexes" };
				},
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
				apiKey: "eval-embedding-key",
				baseUrl: "https://embedding.example/v1",
				features: ["embedding"],
				provider: "openai-compatible",
			},
			principal: createOperatorPrincipal(),
		});
		const createdProfile = await service.createProfile({
			payload: {
				connectionId: createdConnection.connection.connectionId,
				dimensions: 2560,
				kind: "embedding",
				model: "Qwen3-Embedding-4B",
				role: "eval_ragas_embedding",
				timeoutMs: 30000,
				transport: "embeddings",
			},
			principal: createOperatorPrincipal(),
		});
		await service.validateProfile({
			principal: createOperatorPrincipal(),
			profileId: createdProfile.profile.profileId,
		});

		await expect(
			service.activateProfile({
				principal: createOperatorPrincipal(),
				profileId: createdProfile.profile.profileId,
			}),
		).resolves.toMatchObject({
			profile: {
				active: true,
				role: "eval_ragas_embedding",
				status: "active",
			},
		});
		expect(compatibilityChecks).toBe(0);
	});

	it("resolves eval LLM active projection snapshots", async () => {
		const service = buildProviderConfigService({
			decryptSecret: (value) => value,
			encryptSecret: (value) => value,
			generateId: (prefix) => `${prefix}_eval_llm`,
			now: () => new Date("2026-06-16T00:00:00.000Z"),
			store: createInMemoryProviderConfigStore(),
			validators: {
				async validatePrompt() {
					return { message: "prompt provider validated", ok: true, status: "passed" };
				},
			},
		});
		const createdConnection = await service.createConnection({
			payload: {
				apiKey: "eval-llm-key",
				baseUrl: "https://llm.example/v1",
				features: ["prompt"],
				provider: "openai",
			},
			principal: createOperatorPrincipal(),
		});
		for (const role of ["eval_ragas_llm", "eval_judge_llm"] as const) {
			const createdProfile = await service.createProfile({
				payload: {
					connectionId: createdConnection.connection.connectionId,
					kind: "prompt",
					model: "gpt-eval",
					role,
					timeoutMs: 30000,
					transport: "responses",
				},
				principal: createOperatorPrincipal(),
			});
			await service.validateProfile({
				principal: createOperatorPrincipal(),
				profileId: createdProfile.profile.profileId,
			});
			await service.activateProfile({
				principal: createOperatorPrincipal(),
				profileId: createdProfile.profile.profileId,
			});

			await expect(service.getActiveRuntimeSnapshot({ role })).resolves.toMatchObject({
				profile: {
					api_key: "eval-llm-key",
					base_url: "https://llm.example/v1",
					kind: "prompt",
					model: "gpt-eval",
					provider: "openai",
					role,
					transport: "responses",
				},
			});
		}
	});

	it("allows prompt provider profiles to use chat-completions transport", async () => {
		let validationInput: unknown = null;
		const service = buildProviderConfigService({
			decryptSecret: (value) => value,
			encryptSecret: (value) => value,
			generateId: (prefix) => `${prefix}_chat_completions`,
			now: () => new Date("2026-06-16T00:00:00.000Z"),
			store: createInMemoryProviderConfigStore(),
			validators: {
				async validatePrompt(input) {
					validationInput = input;
					return { message: "prompt provider validated", ok: true, status: "passed" };
				},
			},
		});
		const createdConnection = await service.createConnection({
			payload: {
				apiKey: "openai-compatible-key",
				baseUrl: "https://llm-compatible.example/v1",
				features: ["prompt"],
				provider: "openai-compatible",
			},
			principal: createOperatorPrincipal(),
		});
		const createdProfile = await service.createProfile({
			payload: {
				connectionId: createdConnection.connection.connectionId,
				kind: "prompt",
				model: "gpt-compatible",
				role: "primary_agent",
				timeoutMs: 30000,
				transport: "chat_completions",
			},
			principal: createOperatorPrincipal(),
		});
		await service.validateProfile({
			principal: createOperatorPrincipal(),
			profileId: createdProfile.profile.profileId,
		});
		await service.activateProfile({
			principal: createOperatorPrincipal(),
			profileId: createdProfile.profile.profileId,
		});

		expect(validationInput).toMatchObject({
			baseUrl: "https://llm-compatible.example/v1",
			model: "gpt-compatible",
			provider: "openai-compatible",
			role: "primary_agent",
			transport: "chat_completions",
		});
		await expect(
			service.getActiveRuntimeSnapshot({ role: "primary_agent" }),
		).resolves.toMatchObject({
			profile: {
				api_key: "openai-compatible-key",
				base_url: "https://llm-compatible.example/v1",
				kind: "prompt",
				model: "gpt-compatible",
				provider: "openai-compatible",
				role: "primary_agent",
				transport: "chat_completions",
			},
		});
	});

	it("removes active prompt profiles from runtime use when revalidation fails", async () => {
		let validationShouldPass = true;
		const service = buildProviderConfigService({
			decryptSecret: (value) => value,
			encryptSecret: (value) => value,
			generateId: (prefix) => `${prefix}_revalidation`,
			now: () => new Date("2026-06-16T00:00:00.000Z"),
			store: createInMemoryProviderConfigStore(),
			validators: {
				async validatePrompt() {
					return validationShouldPass
						? { message: "prompt provider validated", ok: true, status: "passed" }
						: {
								errorCode: "prompt_response_shape_invalid",
								message: "prompt provider responses response shape is not compatible.",
								ok: false,
								status: "failed",
							};
				},
			},
		});
		const createdConnection = await service.createConnection({
			payload: {
				apiKey: "prompt-key",
				baseUrl: "https://llm.example/v1",
				features: ["prompt"],
				provider: "openai",
			},
			principal: createOperatorPrincipal(),
		});
		const createdProfile = await service.createProfile({
			payload: {
				connectionId: createdConnection.connection.connectionId,
				kind: "prompt",
				model: "gpt-runtime",
				role: "primary_agent",
				timeoutMs: 30000,
				transport: "responses",
			},
			principal: createOperatorPrincipal(),
		});
		await service.validateProfile({
			principal: createOperatorPrincipal(),
			profileId: createdProfile.profile.profileId,
		});
		await service.activateProfile({
			principal: createOperatorPrincipal(),
			profileId: createdProfile.profile.profileId,
		});

		validationShouldPass = false;
		const revalidated = await service.validateProfile({
			principal: createOperatorPrincipal(),
			profileId: createdProfile.profile.profileId,
		});

		expect(revalidated.profile).toMatchObject({
			active: false,
			status: "validation_failed",
			validation: {
				errorCode: "prompt_response_shape_invalid",
				ok: false,
				status: "failed",
			},
		});
		await expect(service.getActiveRuntimeSnapshot({ role: "primary_agent" })).rejects.toMatchObject(
			{
				code: "provider_profile_missing",
			},
		);
	});

	it("resolves Hindsight LLM active projection snapshots", async () => {
		const service = buildProviderConfigService({
			decryptSecret: (value) => value,
			encryptSecret: (value) => value,
			generateId: (prefix) => `${prefix}_hindsight_llm`,
			now: () => new Date("2026-06-16T00:00:00.000Z"),
			store: createInMemoryProviderConfigStore(),
			validators: {
				async validatePrompt() {
					return { message: "prompt provider validated", ok: true, status: "passed" };
				},
			},
		});
		const createdConnection = await service.createConnection({
			payload: {
				apiKey: "hindsight-llm-key",
				baseUrl: "https://llm.example/v1",
				features: ["prompt"],
				provider: "openai",
			},
			principal: createOperatorPrincipal(),
		});
		const createdProfile = await service.createProfile({
			payload: {
				connectionId: createdConnection.connection.connectionId,
				kind: "prompt",
				model: "gpt-memory",
				role: "hindsight_llm",
				timeoutMs: 30000,
				transport: "responses",
			},
			principal: createOperatorPrincipal(),
		});
		await service.validateProfile({
			principal: createOperatorPrincipal(),
			profileId: createdProfile.profile.profileId,
		});
		await service.activateProfile({
			principal: createOperatorPrincipal(),
			profileId: createdProfile.profile.profileId,
		});

		await expect(
			service.getActiveRuntimeSnapshot({ role: "hindsight_llm" }),
		).resolves.toMatchObject({
			profile: {
				api_key: "hindsight-llm-key",
				base_url: "https://llm.example/v1",
				kind: "prompt",
				model: "gpt-memory",
				provider: "openai",
				role: "hindsight_llm",
				transport: "responses",
			},
		});
	});
});
