import { describe, expect, it, vi } from "vitest";

import {
	createDocsSourceSiteFixture,
	type DocsSourceFixture,
} from "../../../apps/campus-web/fixtures/docs-source-site.ts";
import {
	canonicalJsonBytes,
	sha256,
} from "../../../apps/campus-web/src/docs-reader-build/source-catalog.ts";
import {
	artifactHex,
	chunkSetManifestKey,
	indexManifestKey,
	readChunkSet,
} from "../src/artifacts.ts";
import { runBuildChunks } from "../src/chunk-command.ts";
import {
	buildCampusDocsChunkSet,
	buildCampusDocsEmbeddingSet,
	publishCampusDocsIndex,
} from "../src/publisher.ts";
import { QdrantCollectionContentMismatchError } from "../src/qdrant.ts";
import {
	CAMPUS_DOCS_SOURCE_KEY,
	type ArtifactObjectStore,
	type CurrentIndexBinding,
	type IndexCatalog,
	type QdrantIndexClient,
	type Sha256Ref,
} from "../src/types.ts";

describe("Campus docs artifact stages", () => {
	it("builds a deterministic chunk set from the current source and readers", async () => {
		const sourceStore = fixtureStore();
		const artifactStore = new MemoryArtifactStore();
		const first = await buildCampusDocsChunkSet({ artifactStore, sourceStore });
		const second = await buildCampusDocsChunkSet({ artifactStore, sourceStore });
		const loaded = await readChunkSet(artifactStore, first.chunkSet);

		expect(second).toEqual(first);
		expect(first.chunkSet).toMatch(/^sha256:[a-f0-9]{64}$/u);
		expect(first.sourceProjectionSha256).toBe(loaded.manifest.sourceProjectionSha256);
		expect(loaded.manifest.schemaVersion).toBe("campus_docs_chunk_set.v2");
		expect(loaded.manifest).not.toHaveProperty("source");
		expect(loaded.chunks).toHaveLength(first.chunkCount);
		expect(loaded.manifest.documentCount).toBe(first.documentCount);
		expect(loaded.chunks.every((chunk) => chunk.retrievalTextSha256.startsWith("sha256:"))).toBe(true);
	});

	it("keeps source changes outside the current projection out of the chunk set identity", async () => {
		const fixture = createDocsSourceSiteFixture();
		const changedSourceBytes = canonicalJsonBytes({ ...fixture.source, redirects: [] });
		const first = await buildCampusDocsChunkSet({
			artifactStore: new MemoryArtifactStore(),
			sourceStore: fixtureStore(fixture),
		});
		const second = await buildCampusDocsChunkSet({
			artifactStore: new MemoryArtifactStore(),
			sourceStore: fixtureStore(fixture, changedSourceBytes),
		});

		expect(second.sourceDigest).not.toBe(first.sourceDigest);
		expect(second.sourceProjectionSha256).toBe(first.sourceProjectionSha256);
		expect(second.chunkSet).toBe(first.chunkSet);
	});

	it("changes the chunk set when the current document projection changes", async () => {
		const fixture = createDocsSourceSiteFixture();
		const changedDocuments = fixture.source.documents.map((document, index) =>
			index === 0 ? { ...document, title: `${document.title}（修订）` } : document,
		);
		const changedSourceBytes = canonicalJsonBytes({ ...fixture.source, documents: changedDocuments });
		const first = await buildCampusDocsChunkSet({
			artifactStore: new MemoryArtifactStore(),
			sourceStore: fixtureStore(fixture),
		});
		const second = await buildCampusDocsChunkSet({
			artifactStore: new MemoryArtifactStore(),
			sourceStore: fixtureStore(fixture, changedSourceBytes),
		});

		expect(second.sourceProjectionSha256).not.toBe(first.sourceProjectionSha256);
		expect(second.chunkSet).not.toBe(first.chunkSet);
	});

	it("rejects retired v1 chunk set manifests", async () => {
		const store = new MemoryArtifactStore();
		const bytes = canonicalJsonBytes({ schemaVersion: "campus_docs_chunk_set.v1" });
		const id = sha256(bytes);
		store.objects.set(chunkSetManifestKey(id), bytes);

		await expect(readChunkSet(store, id)).rejects.toThrow("chunk set manifest schema is invalid");
	});

	it("prints the chunk set and effective source projection", async () => {
		const store = fixtureStore();
		const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
		try {
			await runBuildChunks({ artifactStore: store, sourceStore: store });
			const result = JSON.parse(String(output.mock.calls[0]?.[0])) as Record<string, unknown>;
			expect(result.chunk_set).toMatch(/^sha256:[a-f0-9]{64}$/u);
			expect(result.source_digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
			expect(result.source_projection_sha256).toMatch(/^sha256:[a-f0-9]{64}$/u);
		} finally {
			output.mockRestore();
		}
	});

	it("reuses embeddings only from the explicitly named compatible embedding set", async () => {
		const store = fixtureStore();
		const chunks = await buildCampusDocsChunkSet({ artifactStore: store, sourceStore: store });
		const generatedTexts: string[] = [];
		const first = await buildCampusDocsEmbeddingSet({
			chunkSet: chunks.chunkSet,
			embedding: embeddingClient(generatedTexts),
			store,
		});
		const secondClient = vi.fn(async () => {
			throw new Error("explicit reuse should cover every input");
		});
		const second = await buildCampusDocsEmbeddingSet({
			chunkSet: chunks.chunkSet,
			embedding: { embed: secondClient },
			reuseEmbeddingSet: first.embeddingSet,
			store,
		});

		expect(first.generatedEmbeddingInputCount).toBe(first.embeddingCount);
		expect(new Set(generatedTexts).size).toBe(first.embeddingCount);
		expect(second).toMatchObject({
			embeddingSet: first.embeddingSet,
			generatedEmbeddingInputCount: 0,
			reusedEmbeddingInputCount: first.embeddingCount,
		});
		expect(secondClient).not.toHaveBeenCalled();
	});

	it("does not infer embedding reuse from existing artifacts", async () => {
		const store = fixtureStore();
		const chunks = await buildCampusDocsChunkSet({ artifactStore: store, sourceStore: store });
		const first = await buildCampusDocsEmbeddingSet({
			chunkSet: chunks.chunkSet,
			embedding: embeddingClient([]),
			store,
		});
		const generatedTexts: string[] = [];
		const second = await buildCampusDocsEmbeddingSet({
			chunkSet: chunks.chunkSet,
			embedding: embeddingClient(generatedTexts),
			store,
		});

		expect(second.embeddingSet).toBe(first.embeddingSet);
		expect(second.generatedEmbeddingInputCount).toBe(second.embeddingCount);
		expect(generatedTexts).toHaveLength(second.embeddingCount);
	});

	it("publishes only explicit chunk and embedding artifacts", async () => {
		const store = fixtureStore();
		const artifacts = await buildArtifacts(store);
		const qdrant = qdrantHarness();
		const catalog = catalogHarness();

		const result = await publishCampusDocsIndex({
			catalog: catalog.client,
			chunkSet: artifacts.chunkSet,
			embeddingSet: artifacts.embeddingSet,
			qdrant: qdrant.client,
			store,
		});

		expect(result.collection).toBe(`campus_docs_${artifactHex(result.index)}`);
		expect(result.pointCount).toBe(artifacts.chunkCount);
		expect(qdrant.created).toEqual([result.collection]);
		expect(qdrant.upsertedPointCount()).toBe(result.pointCount);
		expect(qdrant.validated).toEqual([result.collection]);
		expect(catalog.activated).toHaveLength(1);
		await expect(store.read(indexManifestKey(result.index))).resolves.toBeInstanceOf(Uint8Array);
	});

	it("deletes a newly created collection when the source projection changed", async () => {
		const store = fixtureStore();
		const artifacts = await buildArtifacts(store);
		await store.replace(CAMPUS_DOCS_SOURCE_KEY, new TextEncoder().encode("{}\n"));
		const qdrant = qdrantHarness();
		const catalog = catalogHarness();

		await expect(publishCampusDocsIndex({
			catalog: catalog.client,
			chunkSet: artifacts.chunkSet,
			embeddingSet: artifacts.embeddingSet,
			qdrant: qdrant.client,
			store,
		})).rejects.toThrow("Campus docs source changed after the chunk set was built");
		expect(qdrant.deleted).toHaveLength(1);
		expect(catalog.activated).toEqual([]);
	});

	it("does not delete a malformed collection that is already current", async () => {
		const store = fixtureStore();
		const artifacts = await buildArtifacts(store);
		const firstQdrant = qdrantHarness();
		const catalog = catalogHarness();
		await publishCampusDocsIndex({
			catalog: catalog.client,
			chunkSet: artifacts.chunkSet,
			embeddingSet: artifacts.embeddingSet,
			qdrant: firstQdrant.client,
			store,
		});
		const qdrant = qdrantHarness({ exists: true });
		qdrant.client.validate = async () => {
			throw new QdrantCollectionContentMismatchError("malformed current collection");
		};

		await expect(publishCampusDocsIndex({
			catalog: catalog.client,
			chunkSet: artifacts.chunkSet,
			embeddingSet: artifacts.embeddingSet,
			qdrant: qdrant.client,
			store,
		})).rejects.toThrow("malformed current collection");
		expect(qdrant.deleted).toEqual([]);
	});
});

class MemoryArtifactStore implements ArtifactObjectStore {
	readonly objects = new Map<string, Uint8Array>();

	async read(key: string): Promise<Uint8Array> {
		const value = this.objects.get(key);
		if (!value) throw new Error(`missing object: ${key}`);
		return value;
	}

	async replace(key: string, body: Uint8Array): Promise<void> {
		this.objects.set(key, body);
	}

	async writeImmutable(key: string, body: Uint8Array): Promise<void> {
		const existing = this.objects.get(key);
		if (existing && !Buffer.from(existing).equals(Buffer.from(body))) {
			throw new Error(`immutable object conflict: ${key}`);
		}
		this.objects.set(key, body);
	}
}

function fixtureStore(
	fixture: DocsSourceFixture = createDocsSourceSiteFixture(),
	sourceBytes: Uint8Array = fixture.sourceBytes,
): MemoryArtifactStore {
	const store = new MemoryArtifactStore();
	for (const [key, value] of fixture.objects) store.objects.set(key, value.body);
	store.objects.set(CAMPUS_DOCS_SOURCE_KEY, sourceBytes);
	return store;
}

function embeddingClient(texts: string[]) {
	return {
		async embed(input: { dimensions: number; texts: string[] }) {
			texts.push(...input.texts);
			return input.texts.map((text) => {
				const value = Math.max(1, text.length % 97) / 100;
				return Array(input.dimensions).fill(value) as number[];
			});
		},
	};
}

async function buildArtifacts(store: MemoryArtifactStore): Promise<{
	chunkCount: number;
	chunkSet: Sha256Ref;
	embeddingSet: Sha256Ref;
}> {
	const chunks = await buildCampusDocsChunkSet({ artifactStore: store, sourceStore: store });
	const embeddings = await buildCampusDocsEmbeddingSet({
		chunkSet: chunks.chunkSet,
		embedding: embeddingClient([]),
		store,
	});
	return {
		chunkCount: chunks.chunkCount,
		chunkSet: chunks.chunkSet,
		embeddingSet: embeddings.embeddingSet,
	};
}

function catalogHarness(): {
	activated: CurrentIndexBinding[];
	client: IndexCatalog;
} {
	const activated: CurrentIndexBinding[] = [];
	return {
		activated,
		client: {
			async activate(index) {
				activated.push(index);
				return { noOp: false };
			},
			async current() {
				return activated.at(-1) ?? null;
			},
		},
	};
}

function qdrantHarness(options: { exists?: boolean } = {}): {
	client: QdrantIndexClient;
	created: string[];
	deleted: string[];
	upsertedPointCount(): number;
	validated: string[];
} {
	const created: string[] = [];
	const deleted: string[] = [];
	const validated: string[] = [];
	let upserted = 0;
	return {
		client: {
			async collectionExists() {
				return options.exists ?? false;
			},
			async createCollection({ collection }) {
				created.push(collection);
			},
			async deleteCollection(collection) {
				deleted.push(collection);
			},
			async upsert({ points }) {
				upserted += points.length;
			},
			async validate({ collection }) {
				validated.push(collection);
			},
		},
		created,
		deleted,
		upsertedPointCount: () => upserted,
		validated,
	};
}
