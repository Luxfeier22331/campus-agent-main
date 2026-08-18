import {
	readChunkSet,
	readEmbeddingSet,
	writeChunkData,
	writeChunkSetManifest,
	writeEmbeddingData,
	writeEmbeddingSetManifest,
	writeIndexManifest,
} from "./artifacts.ts";
import {
	CHUNK_SET_DEFINITION,
	COLLECTION_DEFINITION,
	EMBEDDING_SPACE,
} from "./definitions.ts";
import { embedTexts } from "./embedding.ts";
import {
	buildChunks,
	buildCurrentIndexBinding,
	buildPoint,
	loadCurrentVersions,
	parseIndexingSource,
	selectCurrentVersions,
	sha256Text,
	sourceProjectionSha256,
} from "./indexing.ts";
import { QdrantCollectionContentMismatchError } from "./qdrant.ts";
import {
	CAMPUS_DOCS_SOURCE_KEY,
	type BuildChunkSetInput,
	type BuildChunkSetResult,
	type BuildEmbeddingSetInput,
	type BuildEmbeddingSetResult,
	type CurrentIndexBinding,
	type IndexCatalog,
	type IndexManifest,
	type IndexPoint,
	type PublishIndexInput,
	type PublishIndexResult,
	type QdrantIndexClient,
	type ReaderObjectStore,
	type Sha256Ref,
	type StoredChunk,
	type StoredEmbedding,
} from "./types.ts";

const QDRANT_UPSERT_BATCH_SIZE = 64;

export interface IndexCandidate {
	binding: CurrentIndexBinding;
	index: Sha256Ref;
	points: IndexPoint[];
	sourceProjectionSha256: Sha256Ref;
}

export async function buildCampusDocsChunkSet(
	input: BuildChunkSetInput,
): Promise<BuildChunkSetResult> {
	const sourceBytes = await input.sourceStore.read(CAMPUS_DOCS_SOURCE_KEY);
	const source = parseIndexingSource(sourceBytes);
	const selections = await loadCurrentVersions({ readerStore: input.sourceStore, source });
	const chunks = selections.flatMap((selection) =>
		buildChunks({
			document: selection.document,
			reader: selection.reader,
			version: selection.version,
		}),
	);
	if (chunks.length === 0) throw new Error("Campus docs source produced no index chunks");
	assertUnique(chunks.map((chunk) => chunk.chunkId), "chunk identity");
	const storedChunks = chunks.map<StoredChunk>((chunk) => ({
		...chunk,
		retrievalTextSha256: sha256Text(chunk.retrievalText),
	}));
	const sourceProjection = sourceProjectionSha256(selections);
	const chunkData = await writeChunkData(input.artifactStore, storedChunks);
	const manifest = {
		chunkCount: storedChunks.length,
		chunkDefinition: CHUNK_SET_DEFINITION.chunking,
		chunks: chunkData,
		documentCount: selections.length,
		readerSchemaVersion: CHUNK_SET_DEFINITION.readerSchemaVersion,
		schemaVersion: "campus_docs_chunk_set.v2",
		sourceProjectionSha256: sourceProjection,
		sourceSchemaVersion: CHUNK_SET_DEFINITION.sourceSchemaVersion,
	} as const;
	const chunkSet = await writeChunkSetManifest(input.artifactStore, manifest);
	return {
		chunkCount: chunks.length,
		chunkSet,
		documentCount: selections.length,
		sourceDigest: source.sourceDigest,
		sourceProjectionSha256: sourceProjection,
	};
}

export async function buildCampusDocsEmbeddingSet(
	input: BuildEmbeddingSetInput,
): Promise<BuildEmbeddingSetResult> {
	const chunkSet = await readChunkSet(input.artifactStore, input.chunkSet);
	const uniqueChunks = uniqueChunksByRetrievalText(chunkSet.chunks);
	const denseByRetrievalText = new Map<Sha256Ref, number[]>();
	if (input.reuseEmbeddingSet) {
		const reuse = await readEmbeddingSet(input.artifactStore, input.reuseEmbeddingSet);
		for (const embedding of reuse.embeddings) {
			if (
				uniqueChunks.has(embedding.retrievalTextSha256) &&
				!denseByRetrievalText.has(embedding.retrievalTextSha256)
			) {
				denseByRetrievalText.set(embedding.retrievalTextSha256, embedding.dense);
			}
		}
	}
	const reusedEmbeddingInputCount = denseByRetrievalText.size;
	const missing = [...uniqueChunks]
		.filter(([digest]) => !denseByRetrievalText.has(digest))
		.sort(([left], [right]) => left.localeCompare(right));
	const generated = await embedTexts(
		input.embedding,
		missing.map(([, chunk]) => chunk.retrievalText),
	);
	for (const [index, [digest]] of missing.entries()) {
		const vector = generated[index];
		if (!vector) throw new Error(`embedding result is missing input ${digest}`);
		denseByRetrievalText.set(digest, vector);
	}
	const embeddings = [...denseByRetrievalText]
		.sort(([left], [right]) => left.localeCompare(right))
		.map<StoredEmbedding>(([retrievalTextSha256, dense]) => ({ dense, retrievalTextSha256 }));
	if (embeddings.length !== uniqueChunks.size) {
		throw new Error("embedding set does not cover every unique chunk retrieval text");
	}
	const embeddingData = await writeEmbeddingData(input.artifactStore, embeddings);
	const embeddingSet = await writeEmbeddingSetManifest(input.artifactStore, {
		chunkSet: input.chunkSet,
		embeddingCount: embeddings.length,
		embeddingSpace: EMBEDDING_SPACE,
		embeddings: embeddingData,
		schemaVersion: "campus_docs_embedding_set.v2",
	});
	return {
		embeddingCount: embeddings.length,
		embeddingSet,
		generatedEmbeddingInputCount: missing.length,
		reusedEmbeddingInputCount,
	};
}

export async function assembleIndexCandidate(input: {
	artifactStore: PublishIndexInput["artifactStore"];
	embeddingSet: Sha256Ref;
}): Promise<IndexCandidate> {
	const embeddingSet = await readEmbeddingSet(input.artifactStore, input.embeddingSet);
	const chunkSet = await readChunkSet(input.artifactStore, embeddingSet.manifest.chunkSet);
	const points = buildPoints(chunkSet.chunks, embeddingSet.embeddings);
	const indexManifest: IndexManifest = {
		collectionDefinition: COLLECTION_DEFINITION,
		embeddingSet: input.embeddingSet,
		schemaVersion: "campus_docs_index.v2",
	};
	const index = await writeIndexManifest(input.artifactStore, indexManifest);
	return {
		binding: buildCurrentIndexBinding(index, embeddingSet.manifest.embeddingSpace),
		index,
		points,
		sourceProjectionSha256: chunkSet.manifest.sourceProjectionSha256,
	};
}

export async function materializeQdrantCollection(input: {
	candidate: IndexCandidate;
	currentCollection: string | null;
	qdrant: QdrantIndexClient;
}): Promise<{ created: boolean }> {
	const collection = input.candidate.binding.collection;
	if (await input.qdrant.collectionExists(collection)) {
		try {
			await validateCollection(
				input.qdrant,
				collection,
				input.candidate.points,
				input.candidate.binding.embedding_dimensions,
			);
			return { created: false };
		} catch (error) {
			if (
				input.currentCollection === collection ||
				!(error instanceof QdrantCollectionContentMismatchError)
			) {
				throw error;
			}
			await input.qdrant.deleteCollection(collection);
		}
	}

	await input.qdrant.createCollection({
		collection,
		denseDistance: COLLECTION_DEFINITION.dense.distance,
		denseDimensions: input.candidate.binding.embedding_dimensions,
		denseVectorName: COLLECTION_DEFINITION.dense.vectorName,
		sparseVectorName: COLLECTION_DEFINITION.sparse.vectorName,
	});
	try {
		await upsertPoints(input.qdrant, collection, input.candidate.points);
		await validateCollection(
			input.qdrant,
			collection,
			input.candidate.points,
			input.candidate.binding.embedding_dimensions,
		);
	} catch (error) {
		await input.qdrant.deleteCollection(collection).catch(() => undefined);
		throw error;
	}
	return { created: true };
}

export async function activateCurrentIndex(input: {
	binding: CurrentIndexBinding;
	catalog: IndexCatalog;
	expectedSourceProjection: Sha256Ref;
	sourceStore: ReaderObjectStore;
}): Promise<{ noOp: boolean }> {
	await assertSourceProjectionUnchanged(
		input.sourceStore,
		input.expectedSourceProjection,
	);
	return input.catalog.activate(input.binding);
}

export async function publishCampusDocsIndex(
	input: PublishIndexInput,
): Promise<PublishIndexResult> {
	const candidate = await assembleIndexCandidate({
		artifactStore: input.artifactStore,
		embeddingSet: input.embeddingSet,
	});
	const current = await input.catalog.current();
	const targetWasCurrent = current?.collection === candidate.binding.collection;
	const materialized = await materializeQdrantCollection({
		candidate,
		currentCollection: current?.collection ?? null,
		qdrant: input.qdrant,
	});
	let activated: { noOp: boolean };
	try {
		activated = await activateCurrentIndex({
			binding: candidate.binding,
			catalog: input.catalog,
			expectedSourceProjection: candidate.sourceProjectionSha256,
			sourceStore: input.sourceStore,
		});
	} catch (error) {
		if (materialized.created) {
			await input.qdrant.deleteCollection(candidate.binding.collection).catch(() => undefined);
		}
		throw error;
	}
	return {
		collection: candidate.binding.collection,
		index: candidate.index,
		noOp: materialized.created && targetWasCurrent ? false : activated.noOp,
		pointCount: candidate.points.length,
	};
}

function uniqueChunksByRetrievalText(chunks: readonly StoredChunk[]): Map<Sha256Ref, StoredChunk> {
	const result = new Map<Sha256Ref, StoredChunk>();
	for (const chunk of chunks) {
		const digest = sha256Text(chunk.retrievalText);
		if (digest !== chunk.retrievalTextSha256) {
			throw new Error(`chunk retrieval text digest does not match: ${chunk.chunkId}`);
		}
		if (!result.has(digest)) result.set(digest, chunk);
	}
	return result;
}

function buildPoints(
	chunks: readonly StoredChunk[],
	embeddings: readonly StoredEmbedding[],
): IndexPoint[] {
	const uniqueChunks = uniqueChunksByRetrievalText(chunks);
	const denseByRetrievalText = new Map<Sha256Ref, number[]>();
	for (const embedding of embeddings) {
		if (denseByRetrievalText.has(embedding.retrievalTextSha256)) {
			throw new Error(`embedding data repeats retrieval text: ${embedding.retrievalTextSha256}`);
		}
		denseByRetrievalText.set(embedding.retrievalTextSha256, embedding.dense);
	}
	if (denseByRetrievalText.size !== uniqueChunks.size) {
		throw new Error("embedding data count does not match unique chunk retrieval texts");
	}
	for (const digest of denseByRetrievalText.keys()) {
		if (!uniqueChunks.has(digest)) {
			throw new Error(`embedding data contains unexpected retrieval text: ${digest}`);
		}
	}
	return chunks.map((chunk) => {
		const dense = denseByRetrievalText.get(chunk.retrievalTextSha256);
		if (!dense) throw new Error(`embedding data is missing chunk ${chunk.chunkId}`);
		return buildPoint({ chunk, dense });
	});
}

async function upsertPoints(
	qdrant: QdrantIndexClient,
	collection: string,
	points: IndexPoint[],
): Promise<void> {
	for (let offset = 0; offset < points.length; offset += QDRANT_UPSERT_BATCH_SIZE) {
		await qdrant.upsert({
			collection,
			denseVectorName: COLLECTION_DEFINITION.dense.vectorName,
			points: points.slice(offset, offset + QDRANT_UPSERT_BATCH_SIZE),
			sparseVectorName: COLLECTION_DEFINITION.sparse.vectorName,
		});
	}
}

async function validateCollection(
	qdrant: QdrantIndexClient,
	collection: string,
	points: IndexPoint[],
	dimensions: number,
): Promise<void> {
	await qdrant.validate({
		collection,
		denseDistance: COLLECTION_DEFINITION.dense.distance,
		denseVectorName: COLLECTION_DEFINITION.dense.vectorName,
		dimensions,
		expectedPointCount: points.length,
		expectedPoints: points,
		sparseModifier: COLLECTION_DEFINITION.sparse.modifier,
		sparseVectorName: COLLECTION_DEFINITION.sparse.vectorName,
	});
}

async function assertSourceProjectionUnchanged(
	store: ReaderObjectStore,
	expectedProjection: Sha256Ref,
): Promise<void> {
	try {
		const sourceBytes = await store.read(CAMPUS_DOCS_SOURCE_KEY);
		const source = parseIndexingSource(sourceBytes);
		const selections = selectCurrentVersions(source.manifest);
		if (sourceProjectionSha256(selections) !== expectedProjection) {
			throw new Error("current source projection differs");
		}
	} catch (error) {
		throw new Error(
			`Campus docs source changed after the chunk set was built: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

function assertUnique(values: readonly string[], label: string): void {
	if (new Set(values).size !== values.length) throw new Error(`${label} is duplicated`);
}
