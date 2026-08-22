import { describe, expect, it } from "vitest";

import {
	createNoticeClassifierFromRuntimeConfig,
	resolveNoticeClassifierRuntimeConfig,
} from "../src/model.ts";

describe("notice classifier provider client", () => {
	it.each(["responses", "chat_completions"] as const)(
		"sends title-only input over %s without SDK headers",
		async (transport) => {
			let requestHeaders: Headers | undefined;
			let requestBody: Record<string, unknown> | undefined;
			const classifier = createNoticeClassifierFromRuntimeConfig(
				{
					apiKey: "secret",
					baseUrl: "https://provider.example/v1",
					model: "classifier-model",
					provider: "openai-compatible",
					schemaVersion: "notice_classifier_runtime_config.v1",
					transport,
				},
				async (_input, init) => {
					requestHeaders = new Headers(init?.headers);
					requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
					return new Response(
						transport === "responses"
							? JSON.stringify({ output_text: '{"category":"campus_operations"}' })
							: JSON.stringify({
									choices: [{ message: { content: '{"category":"campus_operations"}' } }],
								}),
						{ headers: { "content-type": "application/json" }, status: 200 },
					);
				},
			);

			expect(
				await classifier("关于临时关闭校园南门的通知"),
			).toBe("campus_operations");
			expect(requestHeaders?.get("user-agent")).toBeNull();
			expect(requestHeaders?.get("authorization")).toBe("Bearer secret");
			const serialized = JSON.stringify(requestBody);
			expect(serialized).toContain("notice_title");
			expect(serialized).toContain("关于临时关闭校园南门的通知");
			expect(serialized).not.toContain("notice_content_html");
			expect(serialized).not.toContain("notice_type");
			expect(serialized).not.toContain("门户栏目");
		},
	);

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
				name: "notice_classification",
				provider: "openai-compatible",
				schema_version: "model_runtime_config.v1",
				target_sha256: targetSha256,
			});
		});
		expect(result).toMatchObject({ apiKey: "secret", model: "classifier-model" });
		expect(calls).toEqual(["https://model-config.example/internal/model-configs/notice_classification"]);
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
				name: "notice_classification",
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

	it("rejects an invalid Model Config response", async () => {
		await expect(
			importedSnapshot(async () =>
				new Response(JSON.stringify({ schema_version: "wrong" }), { status: 200 }),
			),
		).rejects.toThrow("Model Config is unavailable");
	});
});

async function importedSnapshot(fetchImplementation: typeof fetch) {
	return resolveNoticeClassifierRuntimeConfig(fetchImplementation, "https://model-config.example");
}
