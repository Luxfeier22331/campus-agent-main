import { describe, expect, it } from "vitest";

import { parseCommand } from "../src/cli.ts";
import { parseLocalEmbeddingCommand } from "../src/local-embedding-cli.ts";
import { parseLocalPublishCommand } from "../src/local-publish-cli.ts";

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
			"--reuse-embedding-set",
			embeddingSet,
		])).toEqual({
			baseUrl: "https://embedding.example/v1",
			chunkSet,
			reuseEmbeddingSet: embeddingSet,
		});
	});

	it("rejects missing direct provider options", () => {
		expect(() => parseLocalEmbeddingCommand([
			"--chunk-set",
			chunkSet,
		])).toThrow("Usage: build-embeddings");
		expect(() => parseLocalEmbeddingCommand([
			"--chunk-set",
			chunkSet,
			"--base-url",
			"https://embedding.example/v1",
			"--model",
			"other-model",
		])).toThrow("Usage: build-embeddings");
	});

	it("publishes from the embedding set without a duplicate chunk set argument", () => {
		expect(parseCommand([
			"publish-index",
			"--embedding-set",
			embeddingSet,
		])).toEqual({ embeddingSet, kind: "publish-index" });
		expect(parseCommand([
			"publish-index",
			"--",
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

	it("uses the explicit embedding set for local publish", () => {
		expect(parseLocalPublishCommand(["--", "--embedding-set", embeddingSet])).toEqual({
			embeddingSet,
		});
		expect(() => parseLocalPublishCommand([
			"--embedding-set",
			embeddingSet,
			"--chunk-set",
			chunkSet,
		])).toThrow("Usage: publish-index-local");
	});
});
