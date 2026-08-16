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
	INDEX_DEFINITION,
	type BuildChunkSetInput,
	type BuildChunkSetResult,
	type BuildEmbeddingSetInput,
	type BuildEmbeddingSetResult,
	type IndexManifest,
	type IndexPoint,
	type PublishIndexInput,
	type PublishIndexResult,
	type Sha256Ref,
	type StoredChunk,
	type StoredEmbedding,
} from "./types.ts";

const EMBEDDING_BATCH_SIZE = 32;
const QDRANT_UPSERT_BATCH_SIZE = 64;

export async function buildCampusDocsChunkSet(
	input: BuildChunkSetInput,
): Promise<BuildChunkSetResult> {
	const sourceBytes = await input.store.read(CAMPUS_DOCS_SOURCE_KEY);
	const source = parseIndexingSource(sourceBytes);
	const selections = await loadCurrentVersions({ readerStore: input.store, source });
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
	const chunkData = await writeChunkData(input.store, storedChunks);
	const manifest = {
		chunkCount: storedChunks.length,
		chunkDefinition: INDEX_DEFINITION.chunking,
		chunks: chunkData,
		documentCount: selections.length,
		readerSchemaVersion: INDEX_DEFINITION.readerSchemaVersion,
		schemaVersion: "campus_docs_chunk_set.v1",
		source: {
			byteSize: sourceBytes.byteLength,
			key: CAMPUS_DOCS_SOURCE_KEY,
			sha256: source.sourceDigest,
		},
		sourceProjectionSha256: sourceProjectionSha256(selections),
		sourceSchemaVersion: INDEX_DEFINITION.sourceSchemaVersion,
	} as const;
	const chunkSet = await writeChunkSetManifest(input.store, manifest);
	return {
		chunkCount: chunks.length,
		chunkSet,
		documentCount: selections.length,
		sourceDigest: source.sourceDigest,
	};
}

export async function buildCampusDocsEmbeddingSet(
	input: BuildEmbeddingSetInput,
): Promise<BuildEmbeddingSetResult> {
	const chunkSet = await readChunkSet(input.store, input.chunkSet);
	const uniqueChunks = uniqueChunksByRetrievalText(chunkSet.chunks);
	const denseByRetrievalText = new Map<Sha256Ref, number[]>();
	if (input.reuseEmbeddingSet) {
		const reuse = await readEmbeddingSet(input.store, input.reuseEmbeddingSet);
		if (!embeddingDefinitionsCompatible(reuse.manifest.embeddingDefinition, INDEX_DEFINITION.embedding)) {
			throw new Error("reuse embedding set belongs to a different embedding space");
		}
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
	const generated = await embedChunks(input, missing.map(([, chunk]) => chunk));
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
	const embeddingData = await writeEmbeddingData(input.store, embeddings);
	const embeddingSet = await writeEmbeddingSetManifest(input.store, {
		chunkSet: input.chunkSet,
		embeddingCount: embeddings.length,
		embeddingDefinition: INDEX_DEFINITION.embedding,
		embeddings: embeddingData,
		schemaVersion: "campus_docs_embedding_set.v1",
	});
	return {
		embeddingCount: embeddings.length,
		embeddingSet,
		generatedEmbeddingInputCount: missing.length,
		reusedEmbeddingInputCount,
	};
}

export async function publishCampusDocsIndex(
	input: PublishIndexInput,
): Promise<PublishIndexResult> {
	const [chunkSet, embeddingSet] = await Promise.all([
		readChunkSet(input.store, input.chunkSet),
		readEmbeddingSet(input.store, input.embeddingSet),
	]);
	if (embeddingSet.manifest.chunkSet !== input.chunkSet) {
		throw new Error("embedding set does not reference the requested chunk set");
	}
	const points = buildPoints(chunkSet.chunks, embeddingSet.embeddings);
	const indexManifest: IndexManifest = {
		chunkSet: input.chunkSet,
		documentCount: chunkSet.manifest.documentCount,
		embeddingSet: input.embeddingSet,
		indexDefinition: INDEX_DEFINITION,
		pointCount: points.length,
		schemaVersion: "campus_docs_index.v1",
		sourceProjectionSha256: chunkSet.manifest.sourceProjectionSha256,
	};
	const index = await writeIndexManifest(input.store, indexManifest);
	const binding = buildCurrentIndexBinding(index);
	const current = await input.catalog.current();
	const targetIsCurrent = current?.collection === binding.collection;

	if (await input.qdrant.collectionExists(binding.collection)) {
		try {
			await validateCollection(input, binding.collection, points);
			await assertSourceProjectionUnchanged(input, chunkSet.manifest.sourceProjectionSha256);
			const activated = await input.catalog.activate(binding);
			return { collection: binding.collection, index, noOp: activated.noOp, pointCount: points.length };
		} catch (error) {
			if (targetIsCurrent || !(error instanceof QdrantCollectionContentMismatchError)) throw error;
			await input.qdrant.deleteCollection(binding.collection);
		}
	}

	await input.qdrant.createCollection({
		collection: binding.collection,
		denseDistance: INDEX_DEFINITION.embedding.distance,
		denseDimensions: INDEX_DEFINITION.embedding.dimensions,
		denseVectorName: INDEX_DEFINITION.embedding.vectorName,
		sparseVectorName: INDEX_DEFINITION.sparse.vectorName,
	});
	try {
		await upsertPoints(input, binding.collection, points);
		await validateCollection(input, binding.collection, points);
		await assertSourceProjectionUnchanged(input, chunkSet.manifest.sourceProjectionSha256);
	} catch (error) {
		await input.qdrant.deleteCollection(binding.collection).catch(() => undefined);
		throw error;
	}

	const activated = await input.catalog.activate(binding);
	return {
		collection: binding.collection,
		index,
		noOp: targetIsCurrent ? false : activated.noOp,
		pointCount: points.length,
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

function embeddingDefinitionsCompatible(
	left: typeof INDEX_DEFINITION.embedding,
	right: typeof INDEX_DEFINITION.embedding,
): boolean {
	return left.spaceId === right.spaceId && left.dimensions === right.dimensions;
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
		if (!uniqueChunks.has(digest)) throw new Error(`embedding data contains unexpected retrieval text: ${digest}`);
	}
	return chunks.map((chunk) => {
		const dense = denseByRetrievalText.get(chunk.retrievalTextSha256);
		if (!dense) throw new Error(`embedding data is missing chunk ${chunk.chunkId}`);
		return buildPoint({ chunk, dense });
	});
}

async function embedChunks(
	input: BuildEmbeddingSetInput,
	chunks: readonly { retrievalText: string }[],
): Promise<number[][]> {
	const result: number[][] = [];
	for (let offset = 0; offset < chunks.length; offset += EMBEDDING_BATCH_SIZE) {
		const batch = chunks.slice(offset, offset + EMBEDDING_BATCH_SIZE);
		const vectors = await input.embedding.embed({
			dimensions: INDEX_DEFINITION.embedding.dimensions,
			texts: batch.map((chunk) => chunk.retrievalText),
		});
		if (vectors.length !== batch.length) {
			throw new Error(`embedding result count ${vectors.length} does not match batch count ${batch.length}`);
		}
		for (const [index, vector] of vectors.entries()) {
			if (
				vector.length !== INDEX_DEFINITION.embedding.dimensions ||
				vector.some((value) => !Number.isFinite(value))
			) {
				throw new Error(`embedding vector ${offset + index} has invalid dimensions or values`);
			}
			result.push(vector);
		}
	}
	return result;
}

async function upsertPoints(
	input: PublishIndexInput,
	collection: string,
	points: IndexPoint[],
): Promise<void> {
	for (let offset = 0; offset < points.length; offset += QDRANT_UPSERT_BATCH_SIZE) {
		await input.qdrant.upsert({
			collection,
			denseVectorName: INDEX_DEFINITION.embedding.vectorName,
			points: points.slice(offset, offset + QDRANT_UPSERT_BATCH_SIZE),
			sparseVectorName: INDEX_DEFINITION.sparse.vectorName,
		});
	}
}

async function validateCollection(
	input: PublishIndexInput,
	collection: string,
	points: IndexPoint[],
): Promise<void> {
	await input.qdrant.validate({
		collection,
		denseDistance: INDEX_DEFINITION.embedding.distance,
		denseVectorName: INDEX_DEFINITION.embedding.vectorName,
		dimensions: INDEX_DEFINITION.embedding.dimensions,
		expectedPointCount: points.length,
		expectedPoints: points,
		sparseModifier: INDEX_DEFINITION.sparse.modifier,
		sparseVectorName: INDEX_DEFINITION.sparse.vectorName,
	});
}

async function assertSourceProjectionUnchanged(
	input: PublishIndexInput,
	expectedProjection: Sha256Ref,
): Promise<void> {
	try {
		const sourceBytes = await input.store.read(CAMPUS_DOCS_SOURCE_KEY);
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
