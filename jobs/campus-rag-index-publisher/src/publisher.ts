import { ArtifactValidationError } from "@campus-agent/embedding-runtime";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { compareCanonicalStrings } from "campus-contracts/canonical-order";
import { EMBEDDING_SPACE } from "@campus-agent/embedding-runtime";

import {
	readDocsChunkSet,
	readDocsEmbeddingSet,
	readNoticeChunkRun,
	readNoticeChunks,
	readNoticeEmbeddingSet,
} from "./artifacts.ts";
import { COLLECTION_DEFINITION, COLLECTION_PREFIX } from "./definitions.ts";
import { buildSparseVector } from "./sparse-vector.ts";
import type {
	NoticeChunk,
	QdrantIndexClient,
	ReaderObjectStore,
	Sha256Ref,
	StoredDocsChunk,
	StoredEmbedding,
	UnifiedPoint,
	UnifiedPublishInput,
	UnifiedPublishResult,
} from "./types.ts";

const QDRANT_UPSERT_BATCH_SIZE = 64;

export interface UnifiedIndexCandidate {
	collection: string;
	points: UnifiedPoint[];
}

export async function publishCampusRagIndex(
	input: UnifiedPublishInput,
): Promise<UnifiedPublishResult> {
	input.onPublishProgress?.("assemble");
	const candidate = await assembleCandidate(
		input.artifactStore,
		input.docsEmbeddingSet,
		input.noticeEmbeddingSet,
	);
	input.signal?.throwIfAborted();
	const registered = await input.catalog.register({ collection: candidate.collection,
		docsEmbeddingSet: input.docsEmbeddingSet, noticeEmbeddingSet: input.noticeEmbeddingSet,
		producer: input.producer ?? "manual", ...(input.producerRunId ? { producerRunId: input.producerRunId } : {}) });
	if (registered.rebuildIncomplete && await input.qdrant.collectionExists(candidate.collection)) {
		await input.qdrant.deleteCollection(candidate.collection);
	}
	input.onPublishProgress?.("materialize");
	const materialized = await materializeCollection(input.qdrant, candidate, input.signal);
	await input.catalog.markValidated(candidate.collection);
	input.signal?.throwIfAborted();
	input.onPublishProgress?.("activate");
	const activated = await input.catalog.activate({ collection: candidate.collection, ...(input.expectedCurrent !== undefined ? { expectedCurrent: input.expectedCurrent } : {}) });
	return {
		collection: candidate.collection,
		noOp: activated.obsolete ? true : materialized.created ? false : activated.noOp,
		...(activated.obsolete ? { obsolete: true } : {}),
		pointCount: candidate.points.length,
	};
}

export async function assembleCandidate(
	store: ReaderObjectStore,
	docsEmbeddingSetId: Sha256Ref,
	noticeEmbeddingSetId: Sha256Ref,
): Promise<UnifiedIndexCandidate> {
	const docs = await readDocsEmbeddingSet(store, docsEmbeddingSetId);
	const docsChunks = await readDocsChunkSet(store, docs.manifest.chunkSet);
	const notices = await readNoticeEmbeddingSet(store, noticeEmbeddingSetId);
	const noticeChunks = notices.manifest.schemaVersion === "notice_embedding_set.v1"
		? (await readNoticeChunkRun(store, notices.manifest.chunkRun)).chunks
		: await readNoticeChunks(store, notices.manifest.chunks);
	if (
		docs.manifest.embeddingSpace.dimensions !== EMBEDDING_SPACE.dimensions ||
		notices.manifest.embeddingSpace.dimensions !== EMBEDDING_SPACE.dimensions
	) {
		throw new ArtifactValidationError("Docs and Notice embedding dimensions do not match the active Campus RAG space");
	}
	if (!isDeepStrictEqual(docs.manifest.embeddingSpace, notices.manifest.embeddingSpace)) {
		throw new ArtifactValidationError("Docs and Notice embedding spaces do not match");
	}
	if (docs.manifest.modelTargetSha256 !== notices.manifest.modelTargetSha256) {
		throw new ArtifactValidationError("Docs and Notice model targets do not match");
	}
	const docsPoints = buildDocsPoints(docsChunks.chunks, docs.embeddings);
	const noticePoints = buildNoticePoints(
		noticeChunks,
		notices.embeddings,
	);
	if (docsPoints.length === 0 || noticePoints.length === 0) {
		throw new ArtifactValidationError("Campus RAG candidate must contain Docs and Notice points");
	}
	const identity = sha256(
		JSON.stringify(
			sortJson({
				collectionDefinition: COLLECTION_DEFINITION,
				docsEmbeddingSet: docsEmbeddingSetId,
				noticeEmbeddingSet: noticeEmbeddingSetId,
			}),
		),
	);
	return {
		collection: `${COLLECTION_PREFIX}_${identity.slice("sha256:".length)}`,
		points: [...docsPoints, ...noticePoints],
	};
}

export function buildDocsPoints(
	chunks: readonly StoredDocsChunk[],
	embeddings: readonly StoredEmbedding[],
): UnifiedPoint[] {
	const dense = indexEmbeddings(embeddings, "Docs");
	const expected = new Set(chunks.map((chunk) => chunk.retrievalTextSha256));
	assertExactEmbeddingCoverage(dense, expected, "Docs");
	return chunks.map((chunk) => {
		if (sha256(chunk.retrievalText) !== chunk.retrievalTextSha256) {
			throw new ArtifactValidationError(`Docs retrieval text digest does not match ${chunk.chunkId}`);
		}
		const vector = dense.get(chunk.retrievalTextSha256);
		if (!vector) throw new ArtifactValidationError(`Docs embedding is missing chunk ${chunk.chunkId}`);
		return {
			id: stableId("document", chunk.chunkId),
			payload: {
				chunk_id: chunk.chunkId,
				citation_href: chunk.sectionRef,
				document_id: chunk.documentId,
				document_title: chunk.documentTitle,
				retrieval_text_sha256: chunk.retrievalTextSha256,
				root_unit_ids: chunk.rootUnitIds,
				schema_version: COLLECTION_DEFINITION.pointSchemaVersion,
				section_ref: chunk.sectionRef,
				section_title: chunk.sectionTitle,
				source_kind: "document",
				text: chunk.content,
				text_sha256: sha256(chunk.content),
				version_id: chunk.versionId,
				version_slug: chunk.versionSlug,
				is_current: chunk.isCurrent,
				applicable_from_admission_year: chunk.applicableFromAdmissionYear,
				applicable_to_admission_year: chunk.applicableToAdmissionYear,
				corpus: chunk.corpus ?? (chunk.documentId.startsWith("curriculum-") ? "curriculum" : "regulations"),
			},
			vector: { dense: vector, sparse: buildSparseVector(chunk.retrievalText) },
		} satisfies UnifiedPoint;
	});
}

export function buildNoticePoints(
	chunks: readonly NoticeChunk[],
	embeddings: readonly StoredEmbedding[],
): UnifiedPoint[] {
	const dense = indexEmbeddings(embeddings, "Notice");
	const chunksWithDigest = chunks.map((chunk) => ({
		chunk,
		retrievalTextSha256: sha256(chunk.retrievalText),
	}));
	const expected = new Set(chunksWithDigest.map(({ retrievalTextSha256 }) => retrievalTextSha256));
	assertExactEmbeddingCoverage(dense, expected, "Notice");
	const titles = noticeTitles(chunks);
	return chunksWithDigest.map(({ chunk, retrievalTextSha256 }) => {
		const vector = dense.get(retrievalTextSha256);
		if (!vector) throw new ArtifactValidationError(`Notice embedding is missing chunk ${chunk.chunkId}`);
		const evidence = chunk.retrievalText.slice(chunk.retrievalText.indexOf("\n") + 1);
		const title = titles.get(chunk.noticeId);
		if (!title) throw new ArtifactValidationError(`Notice title is missing: ${chunk.noticeId}`);
		if (!chunk.releasedAt || Number.isNaN(Date.parse(chunk.releasedAt))) {
			throw new ArtifactValidationError(`Notice releasedAt is missing or invalid: ${chunk.noticeId}`);
		}
		return {
			id: stableId("notice", chunk.chunkId),
			payload: {
				chunk_id: chunk.chunkId,
				chunk_index: chunk.chunkIndex,
				citation_href: `/notices/${encodeURIComponent(chunk.noticeId)}`,
				heading_path: chunk.headingPath,
				notice_id: chunk.noticeId,
				released_at: new Date(chunk.releasedAt).toISOString(),
				retrieval_text_sha256: retrievalTextSha256,
				schema_version: COLLECTION_DEFINITION.pointSchemaVersion,
				section_title: chunk.headingPath.at(-1) ?? "正文",
				source_kind: "notice",
				text: evidence,
				text_sha256: sha256(evidence),
				title,
			},
			vector: { dense: vector, sparse: buildSparseVector(chunk.retrievalText) },
		} satisfies UnifiedPoint;
	});
}

export interface StreamingIndexCandidate {
	collection: string;
	pointCount: number;
	points(): AsyncIterable<UnifiedPoint>;
}

function candidatePoints(candidate: UnifiedIndexCandidate | StreamingIndexCandidate) {
	return typeof candidate.points === "function" ? candidate.points() : candidate.points;
}

export async function materializeCollection(
	qdrant: QdrantIndexClient,
	candidate: UnifiedIndexCandidate | StreamingIndexCandidate,
	signal?: AbortSignal,
): Promise<{ created: boolean }> {
	if (await qdrant.collectionExists(candidate.collection)) {
		await validate(qdrant, candidate);
		return { created: false };
	}
	await qdrant.createCollection({
		collection: candidate.collection,
		denseDistance: COLLECTION_DEFINITION.dense.distance,
		denseDimensions: EMBEDDING_SPACE.dimensions,
		denseVectorName: COLLECTION_DEFINITION.dense.vectorName,
		sparseVectorName: COLLECTION_DEFINITION.sparse.vectorName,
		payloadIndexes: ["source_kind", "document_id", "version_slug", "is_current", "corpus", "applicable_from_admission_year", "applicable_to_admission_year"],
	});
	try {
		let batch: UnifiedPoint[] = [];
		const write = async () => {
			signal?.throwIfAborted();
			await qdrant.upsert({ collection: candidate.collection,
				denseVectorName: COLLECTION_DEFINITION.dense.vectorName,
				points: batch, sparseVectorName: COLLECTION_DEFINITION.sparse.vectorName });
			batch = [];
		};
		for await (const point of candidatePoints(candidate)) {
			batch.push(point);
			if (batch.length === QDRANT_UPSERT_BATCH_SIZE) await write();
		}
		if (batch.length) await write();
		await validate(qdrant, candidate);
	} catch (error) {
		await qdrant.deleteCollection(candidate.collection).catch(() => undefined);
		throw error;
	}
	return { created: true };
}

async function validate(
	qdrant: QdrantIndexClient,
	candidate: UnifiedIndexCandidate | StreamingIndexCandidate,
): Promise<void> {
	await qdrant.validate({
		collection: candidate.collection,
		denseDistance: COLLECTION_DEFINITION.dense.distance,
		denseVectorName: COLLECTION_DEFINITION.dense.vectorName,
		dimensions: EMBEDDING_SPACE.dimensions,
		expectedPointCount: "pointCount" in candidate ? candidate.pointCount : candidate.points.length,
		expectedPoints: candidatePoints(candidate),
		sparseModifier: COLLECTION_DEFINITION.sparse.modifier,
		sparseVectorName: COLLECTION_DEFINITION.sparse.vectorName,
	});
}

function indexEmbeddings(
	embeddings: readonly StoredEmbedding[],
	label: string,
): Map<Sha256Ref, number[]> {
	const dense = new Map<Sha256Ref, number[]>();
	for (const embedding of embeddings) {
		if (dense.has(embedding.retrievalTextSha256)) {
			throw new ArtifactValidationError(`${label} embedding data repeats retrieval text: ${embedding.retrievalTextSha256}`);
		}
		dense.set(embedding.retrievalTextSha256, embedding.dense);
	}
	return dense;
}

function assertExactEmbeddingCoverage(
	dense: ReadonlyMap<Sha256Ref, number[]>,
	expected: ReadonlySet<Sha256Ref>,
	label: string,
): void {
	if (
		dense.size !== expected.size ||
		[...dense.keys()].some((digest) => !expected.has(digest))
	) {
		throw new ArtifactValidationError(`${label} embedding data does not exactly cover the chunk retrieval texts`);
	}
}

function noticeTitles(chunks: readonly NoticeChunk[]): Map<string, string> {
	const result = new Map<string, string>();
	for (const chunk of chunks) {
		const title = chunk.retrievalText.split("\n", 1)[0]?.trim();
		if (!title) throw new ArtifactValidationError(`Notice title is missing from chunk ${chunk.chunkId}`);
		const existing = result.get(chunk.noticeId);
		if (existing && existing !== title) {
			throw new ArtifactValidationError(`Notice title is inconsistent: ${chunk.noticeId}`);
		}
		if (!existing) {
			result.set(chunk.noticeId, title);
		}
	}
	return result;
}

function stableId(source: string, chunkId: string): string {
	const digest = createHash("sha256")
		.update(`${COLLECTION_DEFINITION.pointSchemaVersion}\u0000${source}\u0000${chunkId}`)
		.digest("hex");
	return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-${((Number.parseInt(digest[16] ?? "0", 16) & 3) | 8).toString(16)}${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

function sha256(value: Uint8Array | string): Sha256Ref {
	return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function sortJson(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortJson);
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => compareCanonicalStrings(left, right))
			.map(([key, child]) => [key, sortJson(child)]),
	);
}
