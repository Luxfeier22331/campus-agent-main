import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseCommand } from "../src/cli.ts";
import { readChunkEvalQueryCases } from "../src/chunk-eval.ts";
import { parseEmbeddingEvalCommand } from "../src/embedding-eval-cli.ts";
import { parseLocalEmbeddingCommand } from "../src/local-embedding-cli.ts";

const chunkSet = `sha256:${"a".repeat(64)}`;
const embeddingSet = `sha256:${"b".repeat(64)}`;

describe("local Campus docs embedding commands", () => {
	it("requires an explicit provider connection for embedding generation", () => {
		expect(parseLocalEmbeddingCommand([
			"--",
			"--chunk-set",
			chunkSet,
			"--base-url",
			"https://embedding.example/v1",
			"--model",
			"Qwen3-Embedding-4B",
			"--reuse-embedding-set",
			embeddingSet,
		])).toEqual({
			baseUrl: "https://embedding.example/v1",
			chunkSet,
			model: "Qwen3-Embedding-4B",
			reuseEmbeddingSet: embeddingSet,
		});
	});

	it("uses the versioned query cases by default for dense eval", () => {
		const command = parseEmbeddingEvalCommand([
			"--embedding-set",
			embeddingSet,
			"--base-url",
			"https://embedding.example/v1",
			"--model",
			"Qwen3-Embedding-4B",
		]);

		expect(command.embeddingSet).toBe(embeddingSet);
		expect(command.queryCasesPath).toMatch(
			/jobs\/campus-docs-index-publisher\/eval\/query-cases\.json$/u,
		);
	});

	it("keeps the 15 current-document query cases executable", async () => {
		const queryCases = await readChunkEvalQueryCases(
			fileURLToPath(new URL("../eval/query-cases.json", import.meta.url)),
		);

		expect(queryCases).toHaveLength(15);
	});

	it("rejects missing direct provider options", () => {
		expect(() => parseLocalEmbeddingCommand([
			"--chunk-set",
			chunkSet,
		])).toThrow("Usage: build-embeddings");
	});

	it("publishes from the embedding set without a duplicate chunk set argument", () => {
		expect(parseCommand([
			"publish-index",
			"--embedding-set",
			embeddingSet,
		])).toEqual({ embeddingSet, kind: "publish-index" });
		expect(() => parseCommand([
			"publish-index",
			"--chunk-set",
			chunkSet,
			"--embedding-set",
			embeddingSet,
		])).toThrow("Usage: build-chunks");
	});
});
