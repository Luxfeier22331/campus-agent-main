import {
	buildChunks,
	buildCurrentIndexBinding,
	buildPoint,
	buildPointId,
	loadCurrentVersions,
	parseIndexingSource,
	selectCurrentVersions,
	sha256Text,
} from "./indexing.ts";
import { QdrantCollectionContentMismatchError } from "./qdrant.ts";
import type {
	CurrentIndexBinding,
	IndexChunk,
	IndexPoint,
	PublishInput,
	PublishResult,
} from "./types.ts";
import { INDEX_DEFINITION } from "./types.ts";

const EMBEDDING_BATCH_SIZE = 32;

export async function publishCampusDocsIndex(input: PublishInput): Promise<PublishResult> {
	const source = parseIndexingSource(input.sourceBytes);
	const selections = await loadCurrentVersions({
		readerStore: input.readerStore,
		source,
	});
	const binding = buildCurrentIndexBinding({
		embeddingSpaceId: input.embedding.spaceId,
		selections,
	});
	const baseResult = {
		collection: binding.collection,
		documentCount: selections.length,
		sourceDigest: source.sourceDigest,
	};
	const current = await input.catalog.current();
	const targetIsCurrent = current?.collection === binding.collection;
	const chunks = selections.flatMap((selection) =>
		buildChunks({
			document: selection.document,
			reader: selection.reader,
			version: selection.version,
		}),
	);
	if (chunks.length === 0) {
		throw new Error("Campus docs source produced no index chunks");
	}

	if (await input.qdrant.collectionExists(binding.collection)) {
		try {
			const points = await pointsFromStoredCollection(input, binding, chunks);
			await validateCollection(input, binding.collection, points);
			await assertInputsUnchanged(input, binding.collection);
			const activated = await input.catalog.activate(binding);
			return { ...baseResult, noOp: activated.noOp };
		} catch (error) {
			if (targetIsCurrent || !(error instanceof QdrantCollectionContentMismatchError)) throw error;
			await input.qdrant.deleteCollection(binding.collection);
		}
	}

	const uniqueChunks = uniqueChunksByRetrievalText(chunks);
	const denseByRetrievalText = new Map<`sha256:${string}`, number[]>();
	if (current && !targetIsCurrent && embeddingCompatible(current, binding)) {
		const stored = await input.qdrant.readDenseVectors({
			collection: current.collection,
			denseVectorName: current.dense_vector_name,
			dimensions: current.embedding_dimensions,
		});
		for (const value of stored) {
			if (
				uniqueChunks.has(value.retrievalTextSha256) &&
				!denseByRetrievalText.has(value.retrievalTextSha256)
			) {
				denseByRetrievalText.set(value.retrievalTextSha256, value.dense);
			}
		}
	}
	const reusedEmbeddingInputCount = denseByRetrievalText.size;
	const missingChunks = [...uniqueChunks].filter(([digest]) => !denseByRetrievalText.has(digest));
	const generated = await embedChunks(input, missingChunks.map(([, chunk]) => chunk));
	for (const [index, [digest]] of missingChunks.entries()) {
		const vector = generated[index];
		if (!vector) throw new Error(`embedding result is missing input ${digest}`);
		denseByRetrievalText.set(digest, vector);
	}
	const points = chunks.map((chunk) => {
		const digest = sha256Text(chunk.retrievalText);
		const dense = denseByRetrievalText.get(digest);
		if (!dense) throw new Error(`embedding result is missing chunk ${chunk.chunkId}`);
		return buildPoint({ chunk, dense });
	});

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
		await assertInputsUnchanged(input, binding.collection);
	} catch (error) {
		await input.qdrant.deleteCollection(binding.collection).catch(() => undefined);
		throw error;
	}

	// Activation can have an ambiguous outcome if the database connection fails
	// around COMMIT, so the validated collection is deliberately retained here.
	const activated = await input.catalog.activate(binding);
	return {
		...baseResult,
		generatedEmbeddingInputCount: missingChunks.length,
		noOp: targetIsCurrent ? false : activated.noOp,
		pointCount: points.length,
		reusedEmbeddingInputCount,
		uniqueEmbeddingInputCount: uniqueChunks.size,
	};
}

function uniqueChunksByRetrievalText(chunks: readonly IndexChunk[]): Map<`sha256:${string}`, IndexChunk> {
	const result = new Map<`sha256:${string}`, IndexChunk>();
	for (const chunk of chunks) {
		const digest = sha256Text(chunk.retrievalText);
		if (!result.has(digest)) result.set(digest, chunk);
	}
	return result;
}

function embeddingCompatible(current: CurrentIndexBinding, target: CurrentIndexBinding): boolean {
	return (
		current.embedding_dimensions === target.embedding_dimensions &&
		current.embedding_model === target.embedding_model &&
		current.embedding_provider === target.embedding_provider &&
		current.embedding_space_id === target.embedding_space_id
	);
}

async function pointsFromStoredCollection(
	input: PublishInput,
	binding: CurrentIndexBinding,
	chunks: readonly IndexChunk[],
): Promise<IndexPoint[]> {
	const stored = await input.qdrant.readDenseVectors({
		collection: binding.collection,
		denseVectorName: binding.dense_vector_name,
		dimensions: binding.embedding_dimensions,
	});
	const denseByPoint = new Map(stored.map((value) => [value.pointId, value]));
	return chunks.map((chunk) => {
		const pointId = buildPointId(chunk);
		const value = denseByPoint.get(pointId);
		if (
			!value ||
			value.schemaVersion !== INDEX_DEFINITION.pointSchemaVersion ||
			value.retrievalTextSha256 !== sha256Text(chunk.retrievalText)
		) {
			throw new QdrantCollectionContentMismatchError(
				`Qdrant target collection is missing expected point: ${pointId}`,
			);
		}
		return buildPoint({ chunk, dense: value.dense });
	});
}

async function embedChunks(input: PublishInput, chunks: readonly { retrievalText: string }[]): Promise<number[][]> {
	const result: number[][] = [];
	for (let offset = 0; offset < chunks.length; offset += EMBEDDING_BATCH_SIZE) {
		const batch = chunks.slice(offset, offset + EMBEDDING_BATCH_SIZE);
		const vectors = await input.embedding.embed({
			dimensions: INDEX_DEFINITION.embedding.dimensions,
			model: INDEX_DEFINITION.embedding.model,
			texts: batch.map((chunk) => chunk.retrievalText),
		});
		if (vectors.length !== batch.length) {
			throw new Error(`embedding result count ${vectors.length} does not match batch count ${batch.length}`);
		}
		for (const [index, vector] of vectors.entries()) {
			if (vector.length !== INDEX_DEFINITION.embedding.dimensions || vector.some((value) => !Number.isFinite(value))) {
				throw new Error(`embedding vector ${offset + index} has invalid dimensions or values`);
			}
			result.push(vector);
		}
	}
	return result;
}

async function upsertPoints(input: PublishInput, collection: string, points: IndexPoint[]): Promise<void> {
	const batchSize = 64;
	for (let offset = 0; offset < points.length; offset += batchSize) {
		await input.qdrant.upsert({
			collection,
			denseVectorName: INDEX_DEFINITION.embedding.vectorName,
			points: points.slice(offset, offset + batchSize),
			sparseVectorName: INDEX_DEFINITION.sparse.vectorName,
		});
	}
}

async function validateCollection(input: PublishInput, collection: string, points: IndexPoint[]): Promise<void> {
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

async function assertInputsUnchanged(input: PublishInput, expectedCollection: string): Promise<void> {
	const currentSourceBytes = await input.readSource();
	let currentSource: ReturnType<typeof parseIndexingSource>;
	try {
		currentSource = parseIndexingSource(currentSourceBytes);
		const selections = selectCurrentVersions(currentSource.manifest);
		if (
			buildCurrentIndexBinding({
				embeddingSpaceId: input.embedding.spaceId,
				selections,
			}).collection !== expectedCollection
		) {
			throw new Error("current source projection differs");
		}
	} catch (error) {
		throw new Error(
			`Campus docs source changed while the index was being built: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}
