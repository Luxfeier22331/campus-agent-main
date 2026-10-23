import { describe, expect, it } from "vitest";

import {
	createNoticeClassifierFromRuntimeConfig,
	resolveNoticeClassifierRuntimeConfig,
} from "../src/model.ts";
import { NoticeClassificationProviderError } from "../src/classifier.ts";

describe("notice classifier provider client", () => {
	it.each(["openai.responses", "openai.chat_completions"] as const)(
		"sends the title and portal column over %s without SDK headers",
		async (protocol) => {
			let requestHeaders: Headers | undefined;
			let requestBody: Record<string, unknown> | undefined;
			const label = '{"category":"service_info","intent":"notice"}';
			const classifier = createNoticeClassifierFromRuntimeConfig(
				{
					apiKey: "secret",
					baseUrl: "https://provider.example/v1",
					model: "classifier-model",
					name: "notice_classification_llm",
					protocol,
					schemaVersion: "notice_classifier_runtime_config.v2",
				},
				async (_input, init) => {
					requestHeaders = new Headers(init?.headers);
					requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
					return Response.json(
						protocol === "openai.responses"
							? { output_text: label }
							: { choices: [{ message: { content: label } }] },
					);
				},
			);

			expect(
				await classifier({ noticeTitle: "关于临时关闭校园南门的通知", noticeTypeName: "办公通知" }),
			).toEqual({ category: "service_info", intent: "notice" });
			expect(requestHeaders?.get("user-agent")).toBeNull();
			expect(requestHeaders?.get("authorization")).toBe("Bearer secret");
			const serialized = JSON.stringify(requestBody);
			expect(serialized).toContain("notice_type：办公通知\\n标题：关于临时关闭校园南门的通知");
			expect(serialized).not.toContain("notice_content_html");
		},
	);

	it.each([
		["nace", "drex-max"],
		["typesafe", "jev-latest"],
	])("accepts the %s decision credential selected behind the alias", async (provider, model) => {
		const result = await importedSnapshot(async () =>
			Response.json({
				api_key: "secret",
				api_protocol: "typesafe.systemone",
				base_url: "https://decision.example/v1",
				model,
				name: "notice_classification_decision",
				provider,
				schema_version: "model_runtime_config.v1",
				target_sha256: "a".repeat(64),
			}),
		);
		expect(result).toMatchObject({
			model,
			name: "notice_classification_decision",
			protocol: "typesafe.systemone",
		});
	});

	it("rejects a protocol that does not belong to the selected backend", async () => {
		await expect(
			importedSnapshot(async () =>
				Response.json({
					api_key: "secret",
					api_protocol: "typesafe.systemone",
					base_url: "https://provider.example/v1",
					model: "classifier-model",
					name: "notice_classification_llm",
					provider: "openai-compatible",
					schema_version: "model_runtime_config.v1",
					target_sha256: "a".repeat(64),
				}),
			),
		).rejects.toThrow("Model Config is unavailable");
	});

	it("loads the complete config with one unauthenticated GET", async () => {
		const targetSha256 = "a".repeat(64);
		const calls: string[] = [];
		const result = await importedSnapshot(async (input, init) => {
			calls.push(String(input));
			expect(init?.method).toBe("GET");
			expect(new Headers(init?.headers).get("authorization")).toBeNull();
			return Response.json({
				api_key: "secret",
				api_protocol: "openai.responses",
				base_url: "https://provider.example/v1",
				model: "classifier-model",
				name: "notice_classification_llm",
				provider: "openai-compatible",
				schema_version: "model_runtime_config.v1",
				target_sha256: targetSha256,
			});
		});
		expect(result).toMatchObject({ apiKey: "secret", model: "classifier-model" });
		expect(calls).toEqual([
			"https://model-config.example/internal/model-configs/notice_classification",
		]);
	});

	it.each(["provider", "api_protocol", "name"] as const)(
		"rejects an invalid runtime %s",
		async (field) => {
			const targetSha256 = "a".repeat(64);
			const runtime = {
				api_key: "secret",
				api_protocol: "openai.responses",
				base_url: "https://provider.example/v1",
				model: "classifier-model",
				name: "notice_classification_llm",
				provider: "openai-compatible",
				schema_version: "model_runtime_config.v1",
				target_sha256: targetSha256,
			};
			await expect(
				resolveNoticeClassifierRuntimeConfig(
					async () => Response.json({ ...runtime, [field]: "different" }),
					"https://model-config.example",
				),
			).rejects.toThrow("Model Config is unavailable");
		},
	);

	it("reads a stored backend by name for evaluation and rejects a different backend", async () => {
		const urls: string[] = [];
		const runtime = {
			api_key: "secret",
			api_protocol: "typesafe.systemone",
			base_url: "https://decision.example",
			model: "drex-max",
			name: "notice_classification_decision",
			provider: "nace",
			schema_version: "model_runtime_config.v1",
			target_sha256: "a".repeat(64),
		};
		const fetchRuntime: typeof fetch = async (input) => {
			urls.push(String(input));
			return Response.json(runtime);
		};
		await expect(
			resolveNoticeClassifierRuntimeConfig(
				fetchRuntime,
				"https://model-config.example",
				"notice_classification_decision",
			),
		).resolves.toMatchObject({ name: "notice_classification_decision" });
		expect(urls).toEqual([
			"https://model-config.example/internal/model-configs/notice_classification_decision",
		]);
		await expect(
			resolveNoticeClassifierRuntimeConfig(
				fetchRuntime,
				"https://model-config.example",
				"notice_classification_llm",
			),
		).rejects.toThrow("Model Config is unavailable");
	});

	it("rejects an invalid Model Config response", async () => {
		await expect(
			importedSnapshot(
				async () => new Response(JSON.stringify({ schema_version: "wrong" }), { status: 200 }),
			),
		).rejects.toThrow("Model Config is unavailable");
	});

	it("keeps the provider HTTP status and response body in the error cause", async () => {
		const classifier = createNoticeClassifierFromRuntimeConfig(
			{
				apiKey: "secret",
				baseUrl: "https://provider.example/v1",
				model: "classifier-model",
				name: "notice_classification_llm",
				protocol: "openai.responses",
				schemaVersion: "notice_classifier_runtime_config.v2",
			},
			async () =>
				new Response("upstream response body", {
					status: 429,
					statusText: "Too Many Requests",
				}),
		);

		let failure: unknown;
		try {
			await classifier({ noticeTitle: "测试通知", noticeTypeName: "办公通知" });
		} catch (error) {
			failure = error;
		}

		expect(failure).toBeInstanceOf(NoticeClassificationProviderError);
		expect((failure as NoticeClassificationProviderError).retryable).toBe(true);
		const cause = (failure as Error).cause as { status?: number; message?: string };
		expect(cause.status).toBe(429);
		expect(cause.message).toContain("upstream response body");
	});
});

async function importedSnapshot(fetchImplementation: typeof fetch) {
	return resolveNoticeClassifierRuntimeConfig(fetchImplementation, "https://model-config.example");
}
