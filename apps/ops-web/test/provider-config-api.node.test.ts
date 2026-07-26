// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { createOpsApp } from "../src/server/app";
import { createAllowAllOpsAdmission } from "../src/server/ops-admission";
import { ProviderConfigAdminResponseError } from "../src/server/provider-config-client";
import { ExecutionModelSettingsStatusSchema } from "../src/shared/ops-contract";

const status = {
	etag: "etag-1",
	sampledAt: "2026-07-14T10:00:00.000Z",
	settings: { embedding: null, llm: null },
};

describe("ops model settings BFF", () => {
	it("parses the current-settings contract without release entities", () => {
		expect(ExecutionModelSettingsStatusSchema.parse(status)).toEqual(status);
	});

	it("requires same-origin writes and forwards the hidden ETag", async () => {
		const put = vi.fn().mockResolvedValue(status);
		const app = createOpsApp({
			admission: createAllowAllOpsAdmission({ email: "ops@example.test" }),
			env: { OPS_WEB_PUBLIC_ORIGIN: "https://ops.example.test" },
			providerConfigClient: { getStatus: async () => status, put, validate: vi.fn() },
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
					"if-match": "etag-1",
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
				"if-match": "etag-1",
				origin: "https://ops.example.test",
				"sec-fetch-site": "same-origin",
			},
			method: "PUT",
		});
		expect(accepted.status).toBe(200);
		expect(put).toHaveBeenCalledWith("llm", body, "ops@example.test", "etag-1");
	});

	it("maps execution-control conflicts without exposing its message", async () => {
		const upstream = new Response(
			JSON.stringify({ error: { code: "model_settings_conflict", message: "internal detail" } }),
			{ headers: { "content-type": "application/json" }, status: 409 },
		);
		const app = createOpsApp({
			admission: createAllowAllOpsAdmission(),
			env: { OPS_WEB_PUBLIC_ORIGIN: "https://ops.example.test" },
			providerConfigClient: {
				getStatus: async () => {
					throw new ProviderConfigAdminResponseError(upstream);
				},
				put: vi.fn(),
				validate: vi.fn(),
			},
		});

		const response = await app.request("http://ops.test/api/ops/model-settings/execution");
		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({
			error: {
				code: "OPS_PROVIDER_CONFIG_CONFLICT",
				message: "在线模型配置已被其他操作更新，请刷新后重试。",
				upstreamCode: "model_settings_error",
			},
		});
	});
});
