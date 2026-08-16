import { describe, expect, it, vi } from "vitest";

import {
	createOpenAICompatibleEmbeddingClient,
	fetchEmbeddingProviderSnapshot,
} from "../src/embedding.ts";

const snapshot = {
	apiKey: "test-key",
	baseUrl: "https://embedding.example/v1",
	model: "provider-model-alias",
	provider: "openai-compatible" as const,
	schemaVersion: "embedding_provider_snapshot.v1" as const,
};

describe("OpenAI-compatible embedding client", () => {
	it("loads the one-time provider snapshot without vector-space fields", async () => {
		const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
			api_key: "snapshot-key",
			base_url: "https://embedding.example/v1/",
			model: "embedding-model",
			provider: "openai-compatible",
			schema_version: "embedding_provider_snapshot.v1",
		}), { status: 200 }));

		await expect(fetchEmbeddingProviderSnapshot(fetchMock, "http://snapshot.test/internal")).resolves.toEqual({
			apiKey: "snapshot-key",
			baseUrl: "https://embedding.example/v1",
			model: "embedding-model",
			provider: "openai-compatible",
			schemaVersion: "embedding_provider_snapshot.v1",
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("reorders response vectors by their input index", async () => {
		const client = clientFor({
			data: [
				{ embedding: [2, 2], index: 1 },
				{ embedding: [1, 1], index: 0 },
			],
		});

		await expect(
			client.embed({ dimensions: 2, texts: ["first", "second"] }),
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
			client.embed({ dimensions: 2, texts: ["first", "second"] }),
		).rejects.toThrow(message);
	});

	it("rejects a response that does not cover every input", async () => {
		const client = clientFor({ data: [{ embedding: [1, 1], index: 0 }] });

		await expect(
			client.embed({ dimensions: 2, texts: ["first", "second"] }),
		).rejects.toThrow("embedding provider response is missing index 1");
	});

	it("rejects an invalid vector at its declared input index", async () => {
		const client = clientFor({ data: [{ embedding: [1, "invalid"], index: 0 }] });

		await expect(
			client.embed({ dimensions: 2, texts: ["first"] }),
		).rejects.toThrow("embedding provider vector 0 is invalid");
	});
});

function clientFor(payload: unknown) {
	return createOpenAICompatibleEmbeddingClient(
		snapshot,
		async () =>
			new Response(JSON.stringify(payload), {
				headers: { "content-type": "application/json" },
				status: 200,
			}),
	);
}
