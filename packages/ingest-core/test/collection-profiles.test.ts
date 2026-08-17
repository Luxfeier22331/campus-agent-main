import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCollectionChunkProfile } from "../src/index.ts";
import { loadIngestionTaskRegistryFromFile } from "../src/node.ts";

const CONFIG_ROOT = join(process.cwd(), "../../configs/ingestion");

describe("collection ingestion profiles", () => {
	it("parses every tracked chunk profile", () => {
		for (const { collection, corpus } of listConfiguredCollections(["chunk-profile.json"])) {
			const profile = parseCollectionChunkProfile(
				JSON.parse(
					readFileSync(join(CONFIG_ROOT, corpus, collection, "chunk-profile.json"), "utf8"),
				) as unknown,
			);
			expect(profile.corpus).toBe(corpus);
			expect(profile.collection).toBe(collection);
		}
	});

	it("requires every tracked profile to have a matching task registry", () => {
		for (const { collection, corpus } of listConfiguredCollections([
			"canonical-profile.json",
			"chunk-profile.json",
		])) {
			const registryPath = join(CONFIG_ROOT, corpus, collection, "task-registry.v3.json");
			if (!existsSync(registryPath)) {
				throw new Error(`${corpus}/${collection} has profiles but no task registry`);
			}

			const registry = loadIngestionTaskRegistryFromFile(registryPath);
			if (
				!registry.tasks.some(
					(task) => task.target?.corpus === corpus && task.target.collection === collection,
				)
			) {
				throw new Error(`${corpus}/${collection} has no matching registered task target`);
			}
		}
	});
});

function listConfiguredCollections(
	profileFileNames: readonly string[],
): Array<{ corpus: string; collection: string }> {
	return readdirSync(CONFIG_ROOT, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.flatMap((corpusEntry) => {
			const corpus = corpusEntry.name;
			const corpusPath = join(CONFIG_ROOT, corpus);
			return readdirSync(corpusPath, { withFileTypes: true })
				.filter((entry) => entry.isDirectory())
				.filter((collectionEntry) =>
					profileFileNames.some((profileFileName) =>
						existsSync(join(corpusPath, collectionEntry.name, profileFileName)),
					),
				)
				.map((collectionEntry) => ({ collection: collectionEntry.name, corpus }));
		})
		.sort((left, right) =>
			`${left.corpus}/${left.collection}`.localeCompare(`${right.corpus}/${right.collection}`),
		);
}
