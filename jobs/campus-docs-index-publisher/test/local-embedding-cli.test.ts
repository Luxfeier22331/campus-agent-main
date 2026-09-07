import { describe, expect, it } from "vitest";

import { parseCommand } from "../src/cli.ts";
import { parseLocalEmbeddingCommand } from "../src/local-embedding-cli.ts";
import { parseLocalPublishCommand } from "../src/local-publish-cli.ts";

const chunkSet = `sha256:${"a".repeat(64)}`;
const embeddingSet = `sha256:${"b".repeat(64)}`;

describe("local Campus docs embedding commands", () => {
	it("accepts artifact selections while the provider connection comes from the environment", () => {
		expect(parseLocalEmbeddingCommand([
			"--",
			"--chunk-set",
			chunkSet,
			"--reuse-embedding-set",
			embeddingSet,
		])).toEqual({
			chunkSet,
			reuseEmbeddingSet: embeddingSet,
		});
	});

	it("rejects options outside the artifact selection contract", () => {
		expect(() => parseLocalEmbeddingCommand([
			"--chunk-set",
			chunkSet,
			"--provider",
			"https://embedding.example/v1",
		])).toThrow("Usage: build-embeddings");
	});

	it("reads online artifact selections only from the Job environment", () => {
		expect(parseCommand(["build-embeddings"], {
			CAMPUS_DOCS_CHUNK_SET: chunkSet,
			CAMPUS_DOCS_REUSE_EMBEDDING_SET: embeddingSet,
		})).toEqual({
			chunkSet,
			kind: "build-embeddings",
			reuseEmbeddingSet: embeddingSet,
		});
	});

	it("rejects missing environment selections and retired online flags", () => {
		expect(() => parseCommand(["build-embeddings"], {})).toThrow(
			"CAMPUS_DOCS_CHUNK_SET is required",
		);
		expect(() => parseCommand(["publish-index"], {})).toThrow(
			"Usage: build-chunks | build-embeddings",
		);
		expect(() => parseCommand(
			["publish-index", "--embedding-set", embeddingSet],
			{ CAMPUS_DOCS_EMBEDDING_SET: embeddingSet },
		)).toThrow("Usage: build-chunks | build-embeddings");
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
