import { describe, expect, it, vi } from "vitest";

import { ModelConfigClientError, resolveModelRuntimeConfig } from "../src/model-config-client.ts";

const targetSha256 = "1c8c4cf353f3040aeabe9beb3f3e946acb1c645f95a609ade778d22c920a62ec";

const validRuntimeConfig = {
	api_key: "provider-key",
	api_protocol: "openai.responses",
	base_url: "https://api.openai.com/v1",
	model: "gpt-5-mini",
	name: "primary_agent",
	provider: "openai",
	schema_version: "model_runtime_config.v1",
	target_sha256: targetSha256,
} as const;

describe("Model Config runtime client", () => {
	it("maps a native Gemini target without guessing from the model name", async () => {
		const result = await resolveModelRuntimeConfig(
			{
				baseUrl: "http://model-config",
				fetchImplementation: async () =>
					Response.json({
						...validRuntimeConfig,
						provider: "google",
						api_protocol: "google.generate_content",
						model: "gemini-3.1-flash-lite",
						capabilities: { hosted_web_search: true },
					}),
			},
			targetSha256,
		);
		expect(result).toMatchObject({
			provider: "google",
			transport: "generate_content",
			hostedWebSearch: true,
		});
	});
	it("propagates parent cancellation without relabeling it a config outage", async () => {
		const parent = new AbortController();
		const reason = new Error("operation stopped");
		const pending = resolveModelRuntimeConfig(
			{
				baseUrl: "http://config",
				fetchImplementation: async (_input, init) =>
					new Promise<Response>((_resolve, reject) => {
						init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
							once: true,
						});
					}),
			},
			targetSha256,
			parent.signal,
		);
		parent.abort(reason);
		await expect(pending).rejects.toBe(reason);
	});

	it("keeps the independent config timeout classified as config unavailable", async () => {
		vi.useFakeTimers();
		try {
			const parent = new AbortController();
			const pending = resolveModelRuntimeConfig(
				{
					baseUrl: "http://config",
					fetchImplementation: async () => {
						throw new DOMException("timeout", "TimeoutError");
					},
				},
				targetSha256,
				parent.signal,
			);
			await expect(pending).rejects.toMatchObject({ code: "model_config_unavailable" });
			expect(parent.signal.aborted).toBe(false);
		} finally {
			vi.useRealTimers();
		}
	});
	it("loads the exact target with one unauthenticated GET", async () => {
		const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
			expect(String(input)).toBe(
				`http://model-config/internal/model-configs/primary_agent?expected_target_sha256=${targetSha256}`,
			);
			expect(init?.method).toBe("GET");
			expect(new Headers(init?.headers).get("authorization")).toBeNull();
			expect(init?.body).toBeUndefined();
			return Response.json(validRuntimeConfig);
		});

		await expect(
			resolveModelRuntimeConfig(
				{ baseUrl: "http://model-config/", fetchImplementation: fetchMock },
				targetSha256,
			),
		).resolves.toEqual({
			apiKey: "provider-key",
			baseUrl: "https://api.openai.com/v1",
			model: "gpt-5-mini",
			provider: "openai",
			transport: "responses",
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it.each(["", "stale", "A".repeat(64), `sha256:${"a".repeat(64)}`])(
		"rejects invalid expected hash %j before making a request",
		async (expected) => {
			const fetchMock = vi.fn<typeof fetch>();
			await expect(
				resolveModelRuntimeConfig(
					{ baseUrl: "http://model-config", fetchImplementation: fetchMock },
					expected,
				),
			).rejects.toMatchObject({ code: "invalid_model_target_sha256", status: 400 });
			expect(fetchMock).not.toHaveBeenCalled();
		},
	);

	it.each([
		[409, "model_target_mismatch"],
		[401, "model_config_unavailable"],
		[403, "model_config_unavailable"],
		[503, "model_config_unavailable"],
	] as const)("maps HTTP %i to %s", async (status, code) => {
		await expect(
			resolveModelRuntimeConfig(
				{
					baseUrl: "http://model-config",
					fetchImplementation: async () => new Response(null, { status }),
				},
				targetSha256,
			),
		).rejects.toMatchObject({ code, status });
	});

	it("loads a Chat Completions runtime config for the SDK runner", async () => {
		await expect(
			resolveModelRuntimeConfig(
				{
					baseUrl: "http://model-config",
					fetchImplementation: async () =>
						Response.json({
							...validRuntimeConfig,
							api_protocol: "openai.chat_completions",
						}),
				},
				targetSha256,
			),
		).resolves.toMatchObject({
			provider: "openai",
			transport: "chat_completions",
		});
	});

	it.each([
		["invalid JSON", new Response("not-json")],
		["null payload", Response.json(null)],
		["unknown field", Response.json({ ...validRuntimeConfig, extra: true })],
		["empty secret", Response.json({ ...validRuntimeConfig, api_key: " " })],
		["wrong name", Response.json({ ...validRuntimeConfig, name: "notice_classification" })],
		[
			"mismatched revision",
			Response.json({ ...validRuntimeConfig, target_sha256: "0".repeat(64) }),
		],
	] as const)("rejects %s", async (_name, response) => {
		let error: unknown;
		try {
			await resolveModelRuntimeConfig(
				{
					baseUrl: "http://model-config",
					fetchImplementation: async () => response,
				},
				targetSha256,
			);
		} catch (caught) {
			error = caught;
		}
		expect(error).toBeInstanceOf(ModelConfigClientError);
		expect(error).toMatchObject({ code: "model_config_unavailable", status: 503 });
	});
});
