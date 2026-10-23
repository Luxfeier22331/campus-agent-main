// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { createAllowAllOpsAdmission } from "../src/server/ops-admission";
import {
	createProviderConfigAdminClient,
	ProviderConfigAdminResponseError,
	ProviderConfigAdminUnavailableError,
} from "../src/server/provider-config-client";
import {
	ExecutionModelSettingsStatusSchema,
	LLMModelSettingUpdateSchema,
	NoticeClassifierModelSettingUpdateSchema,
	RerankerModelSettingUpdateSchema,
} from "../src/shared/ops-contract";
import { createTestOpsApp } from "./helpers/ops-app";

const status = ExecutionModelSettingsStatusSchema.parse({
	embeddingContract: {
		dimensions: 2560,
		model: "Qwen3-Embedding-4B",
		provider: "openai-compatible",
		transport: "embeddings",
	},
	sampledAt: "2026-07-14T10:00:00.000Z",
	settings: { embedding: null, llm: null, reranker: null, notice_classifier: null },
});

describe("ops model settings BFF", () => {
	it("admits native Gemini only for the primary LLM slot", () => {
		const config = {
			provider: "google",
			transport: "generate_content",
			baseUrl: "https://generativelanguage.googleapis.com/v1beta",
			model: "gemini-test",
			apiKey: "key",
		};
		expect(LLMModelSettingUpdateSchema.safeParse(config).success).toBe(true);
		expect(
			LLMModelSettingUpdateSchema.safeParse({ ...config, transport: "responses" }).success,
		).toBe(false);
		expect(NoticeClassifierModelSettingUpdateSchema.safeParse(config).success).toBe(false);
		expect(RerankerModelSettingUpdateSchema.safeParse(config).success).toBe(false);
	});
	const config = {
		api_protocol: "openai.responses",
		base_url: "https://provider.example/v1",
		credential_configured: true,
		model: "model",
		provider: "openai-compatible",
		validation: null,
		validated_at: null,
		validated_by: null,
		updated_at: "2026-09-08T00:00:00Z",
		updated_by: "operator",
	};
	const clientFor = (configs: unknown) =>
		createProviderConfigAdminClient(
			{ MODEL_CONFIG_URL: "http://model-config:8000" },
			{
				fetchImplementation: vi.fn(async () =>
					Response.json({ sampled_at: "2026-09-08T00:00:00Z", configs }),
				),
			},
		);
	it.each([
		["google.generate_content", "generate_content"],
		["openai.responses", "responses"],
		["openai.chat_completions", "chat_completions"],
		["openai.embeddings", "embeddings"],
		["cohere.rerank", "rerank"],
	])("maps %s explicitly", async (protocol, transport) => {
		const result = await clientFor({
			primary_agent: { ...config, api_protocol: protocol },
		}).getStatus();
		expect(result.settings.llm?.transport).toBe(transport);
	});
	it.each([{}, { primary_agent: null }])(
		"accepts genuinely absent settings: %j",
		async (configs) => {
			expect((await clientFor(configs).getStatus()).settings.llm).toBeNull();
		},
	);
	it.each([
		undefined,
		null,
		[],
		false,
		{ primary_agent: false },
		{ primary_agent: { ...config, api_protocol: "unknown" } },
		{ primary_agent: { ...config, api_protocol: undefined } },
		{ primary_agent: { ...config, validation: { status: "passed", message: "ok" } } },
		{ primary_agent: { ...config, validation: undefined } },
		{ primary_agent: { ...config, validated_by: "operator" } },
	])("rejects invalid upstream state: %j", async (configs) => {
		await expect(clientFor(configs).getStatus()).rejects.toBeInstanceOf(
			ProviderConfigAdminUnavailableError,
		);
	});
	it("returns the existing unavailable envelope for malformed upstream status", async () => {
		const app = createTestOpsApp({
			admission: createAllowAllOpsAdmission({ email: "ops@example.test" }),
			providerConfigClient: clientFor(null),
		});
		const response = await app.request("http://ops.test/api/ops/model-configs");
		expect(response.status).toBe(503);
		expect(await response.json()).toMatchObject({
			error: { code: "OPS_PROVIDER_CONFIG_UNAVAILABLE" },
		});
	});
	it("parses the current-settings contract without release entities", () => {
		expect(ExecutionModelSettingsStatusSchema.parse(status)).toEqual(status);
	});

	it("maps an unvalidated upstream config to a null latest validation", async () => {
		const fetchImplementation: typeof fetch = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						sampled_at: "2026-08-27T00:00:00.000Z",
						configs: {
							primary_agent: {
								api_protocol: "openai.responses",
								base_url: "https://provider.example/v1",
								credential_configured: true,
								model: "test-model",
								provider: "openai-compatible",
								validated_at: null,
								validated_by: null,
								validation: null,
								updated_at: "2026-08-27T00:00:00.000Z",
								updated_by: "local-seed",
							},
						},
					}),
					{ headers: { "content-type": "application/json" }, status: 200 },
				),
		);
		const client = createProviderConfigAdminClient(
			{ MODEL_CONFIG_URL: "http://model-config:8000/" },
			{ fetchImplementation },
		);

		const mapped = await client.getStatus();
		expect(mapped.settings.llm?.latestValidation).toBeNull();
		expect(fetchImplementation).toHaveBeenCalledWith(
			"http://model-config:8000/internal/admin/model-configs",
			expect.objectContaining({ method: "GET" }),
		);
	});

	it("requires same-origin writes and forwards model discovery", async () => {
		const put = vi.fn().mockResolvedValue(status);
		const validate = vi.fn().mockResolvedValue(status);
		const discoverModels = vi.fn().mockResolvedValue({
			models: ["model-a", "model-b"],
			sampledAt: "2026-07-14T10:01:00.000Z",
		});
		const app = createTestOpsApp({
			admission: createAllowAllOpsAdmission({ email: "ops@example.test" }),
			env: { OPS_WEB_PUBLIC_ORIGIN: "https://ops.example.test" },
			providerConfigClient: {
				getOcrConfig: async () => null,
				putOcrConfig: vi.fn(),
				discoverModels,
				getStatus: async () => status,
				put,
				validate,
			},
		});
		const body = {
			apiKey: "secret",
			baseUrl: "https://provider.example.test/v1",
			model: "gpt-test",
			provider: "openai",
			transport: "responses",
		};
		const rejected = await app.request("http://ops.test/api/ops/model-configs/llm", {
			body: JSON.stringify(body),
			headers: { "content-type": "application/json", origin: "http://attacker.test" },
			method: "PUT",
		});
		expect(rejected.status).toBe(403);

		const retiredField = await app.request("http://ops-web:5178/api/ops/model-configs/llm", {
			body: JSON.stringify({ ...body, timeoutMs: 30_000 }),
			headers: {
				"content-type": "application/json",
				origin: "https://ops.example.test",
				"sec-fetch-site": "same-origin",
			},
			method: "PUT",
		});
		expect(retiredField.status).toBe(400);

		const accepted = await app.request("http://ops-web:5178/api/ops/model-configs/llm", {
			body: JSON.stringify(body),
			headers: {
				"content-type": "application/json",
				origin: "https://ops.example.test",
				"sec-fetch-site": "same-origin",
			},
			method: "PUT",
		});
		expect(accepted.status).toBe(200);
		expect(put).toHaveBeenCalledWith("llm", body, "ops@example.test");

		const catalog = await app.request("http://ops-web:5178/api/ops/model-configs/llm/models", {
			body: JSON.stringify({
				apiKey: "secret",
				baseUrl: "https://provider.example.test/v1",
				provider: "openai",
			}),
			headers: {
				"content-type": "application/json",
				origin: "https://ops.example.test",
				"sec-fetch-site": "same-origin",
			},
			method: "POST",
		});
		expect(catalog.status).toBe(200);
		expect(await catalog.json()).toEqual({
			models: ["model-a", "model-b"],
			sampledAt: "2026-07-14T10:01:00.000Z",
		});
		expect(discoverModels).toHaveBeenNthCalledWith(
			1,
			{
				apiKey: "secret",
				baseUrl: "https://provider.example.test/v1",
				provider: "openai",
			},
			"ops@example.test",
		);

		const classifierCatalog = await app.request(
			"http://ops-web:5178/api/ops/model-configs/notice_classifier/models",
			{
				body: JSON.stringify({
					apiKey: "classifier-secret",
					baseUrl: "https://classifier.example.test/v1",
					provider: "openai-compatible",
				}),
				headers: {
					"content-type": "application/json",
					origin: "https://ops.example.test",
					"sec-fetch-site": "same-origin",
				},
				method: "POST",
			},
		);
		expect(classifierCatalog.status).toBe(200);
		expect(discoverModels).toHaveBeenNthCalledWith(
			2,
			{
				apiKey: "classifier-secret",
				baseUrl: "https://classifier.example.test/v1",
				provider: "openai-compatible",
			},
			"ops@example.test",
			"notice_classifier",
		);

		const rerankerCatalog = await app.request(
			"http://ops-web:5178/api/ops/model-configs/reranker/models",
			{
				body: JSON.stringify({
					apiKey: "reranker-secret",
					baseUrl: "https://reranker.example.test/v1",
					provider: "cohere-compatible",
				}),
				headers: {
					"content-type": "application/json",
					origin: "https://ops.example.test",
					"sec-fetch-site": "same-origin",
				},
				method: "POST",
			},
		);
		expect(rerankerCatalog.status).toBe(200);
		expect(discoverModels).toHaveBeenNthCalledWith(
			3,
			{
				apiKey: "reranker-secret",
				baseUrl: "https://reranker.example.test/v1",
				provider: "cohere-compatible",
			},
			"ops@example.test",
			"reranker",
		);

		const revalidated = await app.request(
			"http://ops-web:5178/api/ops/model-configs/notice_classifier/validate",
			{
				headers: {
					origin: "https://ops.example.test",
					"sec-fetch-site": "same-origin",
				},
				method: "POST",
			},
		);
		expect(revalidated.status).toBe(200);
		expect(validate).toHaveBeenCalledWith("notice_classifier", "ops@example.test");
	});

	it("preserves the upstream validation message", async () => {
		const upstream = new Response(
			JSON.stringify({ error_code: "provider_http_422", message: "HTTP 422: schema unsupported" }),
			{ headers: { "content-type": "application/json" }, status: 422 },
		);
		const app = createTestOpsApp({
			admission: createAllowAllOpsAdmission(),
			env: { OPS_WEB_PUBLIC_ORIGIN: "https://ops.example.test" },
			providerConfigClient: {
				getOcrConfig: async () => null,
				putOcrConfig: vi.fn(),
				discoverModels: vi.fn(),
				getStatus: async () => status,
				put: vi.fn(),
				validate: vi.fn(async () => {
					throw new ProviderConfigAdminResponseError(
						upstream,
						"provider_http_422",
						"HTTP 422: schema unsupported",
					);
				}),
			},
		});

		const response = await app.request(
			"http://ops.test/api/ops/model-configs/notice_classifier/validate",
			{
				headers: {
					origin: "https://ops.example.test",
					"sec-fetch-site": "same-origin",
				},
				method: "POST",
			},
		);
		expect(response.status).toBe(422);
		expect(await response.json()).toEqual({
			error: {
				code: "OPS_PROVIDER_CONFIG_INVALID",
				message: "HTTP 422: schema unsupported",
				upstreamCode: "provider_http_422",
			},
		});
	});

	it("maps agent-control failures without exposing its message", async () => {
		const upstream = new Response(
			JSON.stringify({ error: { code: "model_settings_error", message: "internal detail" } }),
			{ headers: { "content-type": "application/json" }, status: 503 },
		);
		const app = createTestOpsApp({
			admission: createAllowAllOpsAdmission(),
			env: { OPS_WEB_PUBLIC_ORIGIN: "https://ops.example.test" },
			providerConfigClient: {
				getOcrConfig: async () => null,
				putOcrConfig: vi.fn(),
				discoverModels: vi.fn(),
				getStatus: async () => {
					throw new ProviderConfigAdminResponseError(upstream);
				},
				put: vi.fn(),
				validate: vi.fn(),
			},
		});

		const response = await app.request("http://ops.test/api/ops/model-configs");
		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({
			error: {
				code: "OPS_PROVIDER_CONFIG_COMMAND_FAILED",
				message: "在线模型配置操作失败。",
				upstreamCode: "model_settings_error",
			},
		});
	});
});
