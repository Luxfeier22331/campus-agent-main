import { describe, expect, it } from "vitest";

import { createNoticeClassifierFromSnapshot } from "../src/model.ts";

describe("notice classifier provider client", () => {
	it.each(["responses", "chat_completions"] as const)(
		"sends title-only input over %s without SDK headers",
		async (transport) => {
			let requestHeaders: Headers | undefined;
			let requestBody: Record<string, unknown> | undefined;
			const classifier = createNoticeClassifierFromSnapshot(
				{
					apiKey: "secret",
					baseUrl: "https://provider.example/v1",
					model: "classifier-model",
					provider: "openai-compatible",
					schemaVersion: "notice_classifier_provider_snapshot.v1",
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

	it("rejects an invalid provider snapshot response", async () => {
		await expect(
			importedSnapshot(async () =>
				new Response(JSON.stringify({ schema_version: "wrong" }), { status: 200 }),
			),
		).rejects.toThrow("snapshot is invalid");
	});
});

async function importedSnapshot(fetchImplementation: typeof fetch) {
	const { fetchNoticeClassifierProviderSnapshot } = await import("../src/model.ts");
	return fetchNoticeClassifierProviderSnapshot(fetchImplementation, "https://execution.example/snapshot");
}
