import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCollectionChunkProfile } from "../src/index.ts";

const CONFIG_ROOT = join(process.cwd(), "../../configs/ingestion");

describe("collection ingestion profiles", () => {
	it("parses every tracked chunk profile", () => {
		for (const { collection, corpus } of listConfiguredCollections()) {
			const profile = parseCollectionChunkProfile(
				JSON.parse(
					readFileSync(join(CONFIG_ROOT, corpus, collection, "chunk-profile.json"), "utf8"),
				) as unknown,
			);
			expect(profile.corpus).toBe(corpus);
			expect(profile.collection).toBe(collection);
		}
	});
});

function listConfiguredCollections(): Array<{ corpus: string; collection: string }> {
	return readdirSync(CONFIG_ROOT, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.flatMap((corpusEntry) => {
			const corpus = corpusEntry.name;
			const corpusPath = join(CONFIG_ROOT, corpus);
			return readdirSync(corpusPath, { withFileTypes: true })
				.filter((entry) => entry.isDirectory())
				.filter((collectionEntry) =>
					existsSync(join(corpusPath, collectionEntry.name, "chunk-profile.json")),
				)
				.map((collectionEntry) => ({ collection: collectionEntry.name, corpus }));
		})
		.sort((left, right) =>
			`${left.corpus}/${left.collection}`.localeCompare(`${right.corpus}/${right.collection}`),
		);
}
