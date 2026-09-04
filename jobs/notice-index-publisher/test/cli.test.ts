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

	it("rejects arguments outside the two production stages", () => {
		expect(() => parseCommand(["build-chunks", "extra"], {})).toThrow("Usage:");
	});
});
