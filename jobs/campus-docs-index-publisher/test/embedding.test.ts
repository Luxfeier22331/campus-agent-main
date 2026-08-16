import { describe, expect, it } from "vitest";

import { createOpenAICompatibleEmbeddingClient } from "../src/embedding.ts";

const env = {
	CAMPUS_DOCS_EMBEDDING_API_KEY: "test-key",
	CAMPUS_DOCS_EMBEDDING_BASE_URL: "https://embedding.example/v1",
	CAMPUS_DOCS_EMBEDDING_SPACE_ID: "test-space",
};

describe("OpenAI-compatible embedding client", () => {
	it("reorders response vectors by their input index", async () => {
		const client = clientFor({
			data: [
				{ embedding: [2, 2], index: 1 },
				{ embedding: [1, 1], index: 0 },
			],
		});

		await expect(
			client.embed({ dimensions: 2, model: "test-model", texts: ["first", "second"] }),
		).resolves.toEqual([
			[1, 1],
			[2, 2],
		]);
	});

	it.each([
		["missing", { data: [{ embedding: [1, 1] }] }, /index is invalid/u],
		[
			"duplicated",
			{
				data: [
					{ embedding: [1, 1], index: 0 },
					{ embedding: [2, 2], index: 0 },
				],
			},
			/index 0 is duplicated/u,
		],
		["out of range", { data: [{ embedding: [1, 1], index: 2 }] }, /index is invalid/u],
		["non-integer", { data: [{ embedding: [1, 1], index: 0.5 }] }, /index is invalid/u],
	])("rejects a %s response index", async (_label, payload, message) => {
		const client = clientFor(payload);

		await expect(
			client.embed({ dimensions: 2, model: "test-model", texts: ["first", "second"] }),
		).rejects.toThrow(message);
	});

	it("rejects a response that does not cover every input", async () => {
		const client = clientFor({ data: [{ embedding: [1, 1], index: 0 }] });

		await expect(
			client.embed({ dimensions: 2, model: "test-model", texts: ["first", "second"] }),
		).rejects.toThrow("embedding provider response is missing index 1");
	});

	it("rejects an invalid vector at its declared input index", async () => {
		const client = clientFor({ data: [{ embedding: [1, "invalid"], index: 0 }] });

		await expect(
			client.embed({ dimensions: 2, model: "test-model", texts: ["first"] }),
		).rejects.toThrow("embedding provider vector 0 is invalid");
	});
});

function clientFor(payload: unknown) {
	return createOpenAICompatibleEmbeddingClient(
		env,
		async () =>
			new Response(JSON.stringify(payload), {
				headers: { "content-type": "application/json" },
				status: 200,
			}),
	);
}
