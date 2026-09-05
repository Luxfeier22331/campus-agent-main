import { describe, expect, it } from "vitest";

import { parseCommand } from "../src/cli.ts";

describe("notice production CLI", () => {
	it("parses the chunk stage", () => {
		expect(parseCommand(["build-chunks"], {})).toEqual({ kind: "build-chunks" });
	});

	it("takes the embedding input only from the explicit environment value", () => {
		const chunkRun = `sha256:${"a".repeat(64)}`;
		expect(parseCommand(["build-embeddings"], { NOTICE_CHUNK_RUN: chunkRun })).toEqual({
			chunkRun,
			kind: "build-embeddings",
		});
		expect(() => parseCommand(["build-embeddings"], {})).toThrow("NOTICE_CHUNK_RUN must be");
	});

	it("parses the local cache import arguments without model config access", () => {
		const chunkRun = `sha256:${"a".repeat(64)}`;
		const modelTargetSha256 = "b".repeat(64);
		expect(
			parseCommand(
				[
					"import-embedding-cache",
					"--",
					"--chunk-run",
					chunkRun,
					"--model-target-sha256",
					modelTargetSha256,
					"--cache-directory",
					"var/cache",
				],
				{},
			),
		).toEqual({
			cacheDirectory: expect.stringMatching(/var\/cache$/u),
			chunkRun,
			kind: "import-embedding-cache",
			modelTargetSha256,
		});
	});

	it("rejects arguments outside the two production stages", () => {
		expect(() => parseCommand(["build-chunks", "extra"], {})).toThrow("Usage:");
	});
});
