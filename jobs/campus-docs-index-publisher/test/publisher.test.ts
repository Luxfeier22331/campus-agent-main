import { describe, expect, it } from "vitest";

import { createDocsSourceSiteFixture } from "../../../apps/campus-web/fixtures/docs-source-site.ts";
import {
	buildChunks,
	buildCurrentIndexBinding,
	buildPointId,
	loadCurrentVersions,
	parseIndexingSource,
	sha256Text,
} from "../src/indexing.ts";
import { publishCampusDocsIndex } from "../src/publisher.ts";
import { QdrantCollectionContentMismatchError } from "../src/qdrant.ts";
import type {
	CurrentIndexBinding,
	IndexChunk,
	PublishInput,
	StoredDenseVector,
} from "../src/types.ts";
import { INDEX_DEFINITION } from "../src/types.ts";

describe("Campus docs index publisher", () => {
	it("rejects activation when source.json changes during a new build", async () => {
		const harness = createHarness();
		harness.input.readSource = async () => new TextEncoder().encode("{}");

		await expect(publishCampusDocsIndex(harness.input)).rejects.toThrow(
			"Campus docs source changed while the index was being built",
		);
		expect(harness.activationCount()).toBe(0);
		expect(harness.deletedCollections).toHaveLength(1);
	});

	it("embeds unique retrieval texts and activates the validated immutable collection", async () => {
		const harness = createHarness();
		const projection = await sourceProjection(harness.input);
		const result = await publishCampusDocsIndex(harness.input);
		const uniqueTextCount = new Set(projection.chunks.map((chunk) => sha256Text(chunk.retrievalText))).size;

		expect(result).toMatchObject({
			collection: projection.binding.collection,
			documentCount: projection.documentCount,
			generatedEmbeddingInputCount: uniqueTextCount,
			noOp: false,
			pointCount: projection.chunks.length,
			reusedEmbeddingInputCount: 0,
			uniqueEmbeddingInputCount: uniqueTextCount,
		});
		expect(result.sourceDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
		expect(harness.embeddingTexts).toHaveLength(uniqueTextCount);
		expect(harness.embeddingTexts).toEqual(
			[...new Set(projection.chunks.map((chunk) => chunk.retrievalText))],
		);
		expect(harness.activationCount()).toBe(1);
		expect(harness.deletedCollections).toEqual([]);
	});

	it("reuses compatible dense vectors by retrieval text digest", async () => {
		const harness = createHarness();
		const projection = await sourceProjection(harness.input);
		const firstChunk = projection.chunks[0];
		if (!firstChunk) throw new Error("fixture produced no chunks");
		const oldCollection = `campus_docs_${"b".repeat(64)}`;
		harness.input.catalog.current = async () => ({
			...projection.binding,
			collection: oldCollection,
		});
		harness.input.qdrant.readDenseVectors = async ({ collection }) => {
			expect(collection).toBe(oldCollection);
			return [storedVector(firstChunk, 0.25)];
		};

		const result = await publishCampusDocsIndex(harness.input);

		expect(result.reusedEmbeddingInputCount).toBe(1);
		expect(result.generatedEmbeddingInputCount).toBe(
			(result.uniqueEmbeddingInputCount ?? 0) - 1,
		);
		expect(harness.embeddingTexts).not.toContain(firstChunk.retrievalText);
	});

	it("does not reuse dense vectors from a different embedding space", async () => {
		const harness = createHarness();
		const projection = await sourceProjection(harness.input);
		harness.input.catalog.current = async () => ({
			...projection.binding,
			collection: `campus_docs_${"b".repeat(64)}`,
			embedding_space_id: "qwen3-embedding-4b-test-v0",
		});
		harness.input.qdrant.readDenseVectors = async () => {
			throw new Error("incompatible embedding space must not be read");
		};

		const result = await publishCampusDocsIndex(harness.input);

		expect(result.reusedEmbeddingInputCount).toBe(0);
		expect(result.generatedEmbeddingInputCount).toBe(result.uniqueEmbeddingInputCount);
	});

	it("does not reuse a dense vector keyed only by evidence text", async () => {
		const harness = createHarness();
		const projection = await sourceProjection(harness.input);
		const firstChunk = projection.chunks[0];
		if (!firstChunk) throw new Error("fixture produced no chunks");
		const oldCollection = `campus_docs_${"b".repeat(64)}`;
		harness.input.catalog.current = async () => ({
			...projection.binding,
			collection: oldCollection,
		});
		harness.input.qdrant.readDenseVectors = async () => [{
			...storedVector(firstChunk, 0.25),
			retrievalTextSha256: sha256Text(firstChunk.content),
		}];

		const result = await publishCampusDocsIndex(harness.input);

		expect(result.reusedEmbeddingInputCount).toBe(0);
		expect(harness.embeddingTexts).toContain(firstChunk.retrievalText);
	});

	it("fails instead of silently rebuilding when the current collection is malformed", async () => {
		const harness = createHarness();
		const projection = await sourceProjection(harness.input);
		harness.input.catalog.current = async () => ({
			...projection.binding,
			collection: `campus_docs_${"b".repeat(64)}`,
		});
		harness.input.qdrant.readDenseVectors = async () => {
			throw new QdrantCollectionContentMismatchError("malformed current collection");
		};

		await expect(publishCampusDocsIndex(harness.input)).rejects.toThrow(
			"malformed current collection",
		);
		expect(harness.embeddingTexts).toEqual([]);
		expect(harness.createdCollections).toEqual([]);
		expect(harness.deletedCollections).toEqual([]);
	});

	it("returns no-op only after validating the target collection that is already current", async () => {
		const harness = createHarness();
		const projection = await sourceProjection(harness.input);
		harness.setCollectionExists(true);
		harness.input.catalog.current = async () => projection.binding;
		harness.input.catalog.activate = async () => {
			harness.recordActivation();
			return { noOp: true };
		};
		harness.input.qdrant.readDenseVectors = async () =>
			projection.chunks.map((chunk) => storedVector(chunk, 0.2));

		const result = await publishCampusDocsIndex(harness.input);

		expect(result).toMatchObject({ collection: projection.binding.collection, noOp: true });
		expect(result.pointCount).toBeUndefined();
		expect(harness.collectionLookupCount()).toBe(1);
		expect(harness.embeddingTexts).toEqual([]);
	});

	it("rebuilds a missing target collection that is already current", async () => {
		const harness = createHarness();
		const projection = await sourceProjection(harness.input);
		harness.input.catalog.current = async () => projection.binding;
		harness.input.catalog.activate = async () => {
			harness.recordActivation();
			return { noOp: true };
		};

		const result = await publishCampusDocsIndex(harness.input);

		expect(result).toMatchObject({ collection: projection.binding.collection, noOp: false });
		expect(harness.createdCollections).toEqual([projection.binding.collection]);
		expect(result.generatedEmbeddingInputCount).toBe(result.uniqueEmbeddingInputCount);
	});

	it("fails without deleting when the target collection is current but malformed", async () => {
		const harness = createHarness();
		const projection = await sourceProjection(harness.input);
		harness.setCollectionExists(true);
		harness.input.catalog.current = async () => projection.binding;
		harness.input.qdrant.readDenseVectors = async () => {
			throw new QdrantCollectionContentMismatchError("malformed current target");
		};

		await expect(publishCampusDocsIndex(harness.input)).rejects.toThrow("malformed current target");
		expect(harness.deletedCollections).toEqual([]);
		expect(harness.createdCollections).toEqual([]);
	});

	it("validates and activates a complete target collection left by an earlier run", async () => {
		const harness = createHarness();
		const projection = await sourceProjection(harness.input);
		harness.setCollectionExists(true);
		harness.input.qdrant.readDenseVectors = async () =>
			projection.chunks.map((chunk) => storedVector(chunk, 0.2));

		const result = await publishCampusDocsIndex(harness.input);

		expect(result).toMatchObject({ collection: projection.binding.collection, noOp: false });
		expect(result.pointCount).toBeUndefined();
		expect(harness.createdCollections).toEqual([]);
		expect(harness.embeddingTexts).toEqual([]);
		expect(harness.deletedCollections).toEqual([]);
	});

	it("rebuilds an existing target collection only after deterministic content mismatch", async () => {
		const harness = createHarness();
		harness.setCollectionExists(true);
		harness.input.qdrant.readDenseVectors = async () => {
			throw new QdrantCollectionContentMismatchError("invalid target");
		};

		const result = await publishCampusDocsIndex(harness.input);

		expect(harness.deletedCollections).toEqual([result.collection]);
		expect(harness.createdCollections).toEqual([result.collection]);
	});

	it("does not delete an existing target collection after a Qdrant transport failure", async () => {
		const harness = createHarness();
		harness.setCollectionExists(true);
		harness.input.qdrant.readDenseVectors = async () => {
			throw new Error("Qdrant scroll returned HTTP 503");
		};

		await expect(publishCampusDocsIndex(harness.input)).rejects.toThrow("HTTP 503");
		expect(harness.deletedCollections).toEqual([]);
		expect(harness.createdCollections).toEqual([]);
	});

	it("does not delete a validated pre-existing collection when the source changes", async () => {
		const harness = createHarness();
		const projection = await sourceProjection(harness.input);
		harness.setCollectionExists(true);
		harness.input.qdrant.readDenseVectors = async () =>
			projection.chunks.map((chunk) => storedVector(chunk, 0.2));
		harness.input.readSource = async () => new TextEncoder().encode("{}");

		await expect(publishCampusDocsIndex(harness.input)).rejects.toThrow(
			"Campus docs source changed while the index was being built",
		);
		expect(harness.deletedCollections).toEqual([]);
	});

	it("does not delete a validated collection when activation fails", async () => {
		const harness = createHarness();
		harness.input.catalog.activate = async () => {
			throw new Error("activation failed");
		};

		await expect(publishCampusDocsIndex(harness.input)).rejects.toThrow("activation failed");
		expect(harness.deletedCollections).toEqual([]);
	});
});

interface Harness {
	activationCount(): number;
	collectionLookupCount(): number;
	createdCollections: string[];
	deletedCollections: string[];
	embeddingTexts: string[];
	input: PublishInput;
	recordActivation(): void;
	setCollectionExists(value: boolean): void;
}

function createHarness(): Harness {
	const fixture = createDocsSourceSiteFixture();
	const createdCollections: string[] = [];
	const deletedCollections: string[] = [];
	const embeddingTexts: string[] = [];
	let activations = 0;
	let collectionExists = false;
	let collectionLookups = 0;
	const harness: Harness = {
		activationCount: () => activations,
		collectionLookupCount: () => collectionLookups,
		createdCollections,
		deletedCollections,
		embeddingTexts,
		input: {
			catalog: {
				activate: async () => {
					activations += 1;
					return { noOp: false };
				},
				current: async () => null,
			},
			embedding: {
				spaceId: "qwen3-embedding-4b-test-v1",
				embed: async ({ texts, dimensions }) => {
					embeddingTexts.push(...texts);
					return texts.map(() => Array(dimensions).fill(0.1));
				},
			},
			qdrant: {
				collectionExists: async () => {
					collectionLookups += 1;
					return collectionExists;
				},
				createCollection: async ({ collection }) => {
					createdCollections.push(collection);
				},
				deleteCollection: async (collection) => {
					deletedCollections.push(collection);
				},
				readDenseVectors: async () => [],
				upsert: async () => undefined,
				validate: async () => undefined,
			},
			readerStore: {
				read: async (key) => {
					const object = fixture.objects.get(key);
					if (!object) throw new Error(`missing fixture object: ${key}`);
					return object.body;
				},
			},
			readSource: async () => fixture.sourceBytes,
			sourceBytes: fixture.sourceBytes,
		},
		recordActivation: () => {
			activations += 1;
		},
		setCollectionExists: (value) => {
			collectionExists = value;
		},
	};
	return harness;
}

async function sourceProjection(input: PublishInput): Promise<{
	binding: CurrentIndexBinding;
	chunks: IndexChunk[];
	documentCount: number;
}> {
	const source = parseIndexingSource(input.sourceBytes);
	const selections = await loadCurrentVersions({ readerStore: input.readerStore, source });
	return {
		binding: buildCurrentIndexBinding({ embeddingSpaceId: input.embedding.spaceId, selections }),
		chunks: selections.flatMap((selection) =>
			buildChunks({
				document: selection.document,
				reader: selection.reader,
				version: selection.version,
			}),
		),
		documentCount: selections.length,
	};
}

function storedVector(chunk: IndexChunk, value: number): StoredDenseVector {
	return {
		dense: Array(INDEX_DEFINITION.embedding.dimensions).fill(value) as number[],
		pointId: buildPointId(chunk),
		retrievalTextSha256: sha256Text(chunk.retrievalText),
		schemaVersion: INDEX_DEFINITION.pointSchemaVersion,
	};
}
