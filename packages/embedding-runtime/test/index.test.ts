import { describe, expect, it } from "vitest";

import {
	computeEmbeddingTargetSha256,
	createLocalEmbeddingConnection,
	EMBEDDING_SPACE,
	embedTextBatches,
	normalizeEmbeddingBaseUrl,
} from "../src/index.ts";

describe("embedding runtime contract", () => {
	it("normalizes provider URLs and matches the model-config target hash", () => {
		expect(normalizeEmbeddingBaseUrl("  https://embedding.example/v1///  ")).toBe(
			"https://embedding.example/v1",
		);
		expect(computeEmbeddingTargetSha256("https://embedding.example/v1/")).toBe(
			"16794d2d7d70c3c7f95c416c00e51d3e8d1269614c59acbc9d05eac22d76865d",
		);
	});

	it("derives the fixed model target without exposing model or dimensions as input", () => {
		const connection = createLocalEmbeddingConnection({
			apiKey: "secret",
			baseUrl: "https://embedding.example/v1",
		});
		expect(connection.model).toBe("Qwen3-Embedding-4B");
		expect(connection.targetSha256).toBe(computeEmbeddingTargetSha256(connection.baseUrl));
		expect(EMBEDDING_SPACE).toEqual({
			dimensions: 2560,
			spaceId: "qwen3-embedding-4b@2560-v1",
		});
	});

	it("rejects credential-bearing, insecure, or ambiguous provider URLs", () => {
		expect(() => normalizeEmbeddingBaseUrl("https://user:pass@example.test/v1")).toThrow(
			"credential-free",
		);
		expect(() => normalizeEmbeddingBaseUrl("http://embedding.example/v1")).toThrow(
			"https outside loopback",
		);
		expect(() => normalizeEmbeddingBaseUrl("https://embedding.example/v1?x=1")).toThrow(
			"query or fragment",
		);
	});

	it("delivers validated provider results one batch at a time", async () => {
		const batches: Array<{ offset: number; texts: readonly string[] }> = [];
		const progress: [number, number][] = [];
		await embedTextBatches(
			{
				async embed(input) {
					return input.texts.map(() => new Array(input.dimensions).fill(1));
				},
			},
			Array.from({ length: 10 }, (_, index) => `text-${index}`),
			async ({ offset, texts, vectors }) => {
				expect(vectors).toHaveLength(texts.length);
				expect(vectors[0]).toHaveLength(EMBEDDING_SPACE.dimensions);
				batches.push({ offset, texts });
			},
			(completed, total) => progress.push([completed, total]),
		);

		expect(batches.map(({ offset }) => offset).sort((left, right) => left - right)).toEqual([0, 8]);
		expect(progress).toEqual([[10, 10]]);
	});
});
