// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { createAllowAllOpsAdmission } from "../src/server/ops-admission";
import { ProviderConfigAdminResponseError } from "../src/server/provider-config-client";
import { ExecutionModelSettingsStatusSchema } from "../src/shared/ops-contract";
import { createTestOpsApp } from "./helpers/ops-app";

const status = ExecutionModelSettingsStatusSchema.parse({
	embeddingContract: {
		dimensions: 2560,
		model: "Qwen3-Embedding-4B",
		provider: "openai-compatible",
		transport: "embeddings",
	},
	sampledAt: "2026-07-14T10:00:00.000Z",
	settings: { embedding: null, llm: null, notice_classifier: null },
});

describe("ops model settings BFF", () => {
	it("parses the current-settings contract without release entities", () => {
		expect(ExecutionModelSettingsStatusSchema.parse(status)).toEqual(status);
	});

	it("requires same-origin writes and forwards model discovery", async () => {
		const put = vi.fn().mockResolvedValue(status);
		const discoverModels = vi.fn().mockResolvedValue({
			models: ["model-a", "model-b"],
			sampledAt: "2026-07-14T10:01:00.000Z",
		});
		const app = createTestOpsApp({
			admission: createAllowAllOpsAdmission({ email: "ops@example.test" }),
			env: { OPS_WEB_PUBLIC_ORIGIN: "https://ops.example.test" },
			providerConfigClient: {
				discoverModels,
				getStatus: async () => status,
				put,
			},
		});
		const body = {
			apiKey: "secret",
			baseUrl: "https://provider.example.test/v1",
			model: "gpt-test",
			provider: "openai",
			transport: "responses",
		};
		const rejected = await app.request("http://ops.test/api/ops/model-settings/execution/llm", {
			body: JSON.stringify(body),
			headers: { "content-type": "application/json", origin: "http://attacker.test" },
			method: "PUT",
		});
		expect(rejected.status).toBe(403);

		const retiredField = await app.request(
			"http://ops-web:5178/api/ops/model-settings/execution/llm",
			{
				body: JSON.stringify({ ...body, timeoutMs: 30_000 }),
				headers: {
					"content-type": "application/json",
					origin: "https://ops.example.test",
					"sec-fetch-site": "same-origin",
				},
				method: "PUT",
			},
		);
		expect(retiredField.status).toBe(400);

		const accepted = await app.request("http://ops-web:5178/api/ops/model-settings/execution/llm", {
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

		const catalog = await app.request(
			"http://ops-web:5178/api/ops/model-settings/execution/llm/models",
			{
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
			},
		);
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
			"http://ops-web:5178/api/ops/model-settings/execution/notice_classifier/models",
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
	});

	it("maps execution-control failures without exposing its message", async () => {
		const upstream = new Response(
			JSON.stringify({ error: { code: "model_settings_error", message: "internal detail" } }),
			{ headers: { "content-type": "application/json" }, status: 503 },
		);
		const app = createTestOpsApp({
			admission: createAllowAllOpsAdmission(),
			env: { OPS_WEB_PUBLIC_ORIGIN: "https://ops.example.test" },
			providerConfigClient: {
				discoverModels: vi.fn(),
				getStatus: async () => {
					throw new ProviderConfigAdminResponseError(upstream);
				},
				put: vi.fn(),
			},
		});

		const response = await app.request("http://ops.test/api/ops/model-settings/execution");
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
