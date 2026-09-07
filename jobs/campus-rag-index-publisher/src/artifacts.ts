import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { EMBEDDING_SPACE } from "@campus-agent/embedding-runtime";

import type {
	ArtifactReference,
	DocsChunkSetManifest,
	DocsEmbeddingSetManifest,
	NoticeChunk,
	NoticeChunkRunData,
	NoticeChunkRunManifest,
	NoticeEmbeddingSetData,
	NoticeEmbeddingSetManifest,
	ObjectReference,
	ReaderObjectStore,
	Sha256Ref,
	StoredDocsChunk,
	StoredEmbedding,
} from "./types.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

const DOCS_CHUNK_DEFINITION = {
	algorithm: "campus_docs_reader_elements.v5",
	maxChars: 1600,
	overlapChars: 0,
	targetChars: 800,
} as const;

const DOCS_READER_SCHEMA_VERSION = "campus_docs_reader.v3";
const DOCS_SOURCE_SCHEMA_VERSION = "campus_docs_source.v4";
const DOCS_CHUNK_SET_SCHEMA_VERSION = "campus_docs_chunk_set.v2";
const DOCS_EMBEDDING_SET_SCHEMA_VERSION = "campus_docs_embedding_set.v3";
const NOTICE_EMBEDDING_SET_SCHEMA_VERSION = "notice_embedding_set.v1";
const NOTICE_CHUNK_RUN_SCHEMA_VERSION = "notice_chunk_run.v1";

export function assertSha256Ref(value: string, label: string): Sha256Ref {
	if (!/^sha256:[a-f0-9]{64}$/u.test(value)) {
		throw new Error(`${label} must be sha256:<64 lowercase hex characters>`);
	}
	return value as Sha256Ref;
}

export function artifactHex(value: Sha256Ref): string {
	return value.slice("sha256:".length);
}

export function chunkSetManifestKey(id: Sha256Ref): string {
	return `campus-docs/rag/chunk-sets/sha256/${artifactHex(id)}/manifest.json`;
}

export function embeddingSetManifestKey(id: Sha256Ref): string {
	return `campus-docs/rag/embedding-sets/sha256/${artifactHex(id)}/manifest.json`;
}

export function noticeChunkRunPrefix(run: Sha256Ref): string {
	return `notices/rag/chunk-runs/sha256/${artifactHex(run)}`;
}

export function noticeEmbeddingSetManifestKey(id: Sha256Ref): string {
	return `notices/rag/embedding-sets/sha256/${artifactHex(id)}/manifest.json`;
}

export async function readDocsChunkSet(
	store: ReaderObjectStore,
	id: Sha256Ref,
): Promise<{ chunks: StoredDocsChunk[]; manifest: DocsChunkSetManifest }> {
	const manifest = await readManifest(store, chunkSetManifestKey(id), id, parseDocsChunkSetManifest);
	const bytes = await readVerifiedObject(store, manifest.chunks, "Campus Docs chunk data");
	const chunks = decodeNdjson(bytes, parseDocsChunk);
	if (chunks.length !== manifest.chunkCount) {
		throw new Error(`Campus Docs chunk data count ${chunks.length} does not match ${manifest.chunkCount}`);
	}
	return { chunks, manifest };
}

export async function readDocsEmbeddingSet(
	store: ReaderObjectStore,
	id: Sha256Ref,
): Promise<{ embeddings: StoredEmbedding[]; manifest: DocsEmbeddingSetManifest }> {
	const manifest = await readManifest(
		store,
		embeddingSetManifestKey(id),
		id,
		parseDocsEmbeddingSetManifest,
	);
	const bytes = await readVerifiedObject(store, manifest.embeddings, "Campus Docs embedding data");
	const embeddings = decodeNdjson(bytes, (value, index) =>
		parseEmbedding(value, index, manifest.embeddingSpace.dimensions, "Docs"),
	);
	if (embeddings.length !== manifest.embeddingCount) {
		throw new Error(
			`Campus Docs embedding data count ${embeddings.length} does not match ${manifest.embeddingCount}`,
		);
	}
	return { embeddings, manifest };
}

export async function readNoticeChunkRun(
	store: ReaderObjectStore,
	run: Sha256Ref,
): Promise<NoticeChunkRunData> {
	const prefix = noticeChunkRunPrefix(run);
	const manifestBytes = await store.read(`${prefix}/manifest.json`);
	if (sha256(manifestBytes) !== run) {
		throw new Error(`notice chunk run manifest digest does not match ${run}`);
	}
	const manifest = parseNoticeChunkRunManifest(parseJson(manifestBytes, "notice chunk run manifest"));
	const chunkBytes = await readVerifiedObject(
		store,
		objectReferenceFromArtifact(`${prefix}/`, manifest.chunks),
		"notice chunk data",
	);
	const chunks = decodeNoticeChunks(chunkBytes);
	if (chunks.length !== manifest.chunkCount) {
		throw new Error(`notice chunk data count ${chunks.length} does not match ${manifest.chunkCount}`);
	}
	const chunksByNoticeId = groupNoticeChunks(chunks);
	if (chunksByNoticeId.size !== manifest.noticeCount) {
		throw new Error("notice chunk notice count does not match the run manifest");
	}
	return { chunks, chunksByNoticeId, manifest };
}

export async function readNoticeEmbeddingSet(
	store: ReaderObjectStore,
	id: Sha256Ref,
): Promise<NoticeEmbeddingSetData> {
	const manifest = await readManifest(
		store,
		noticeEmbeddingSetManifestKey(id),
		id,
		parseNoticeEmbeddingSetManifest,
	);
	const bytes = await readVerifiedObject(store, manifest.embeddings, "notice embedding data");
	const embeddings = decodeNdjson(bytes, (value, index) =>
		parseEmbedding(value, index, manifest.embeddingSpace.dimensions, "Notice"),
	);
	if (embeddings.length !== manifest.embeddingCount) {
		throw new Error(`notice embedding data count ${embeddings.length} does not match ${manifest.embeddingCount}`);
	}
	const seen = new Set<Sha256Ref>();
	for (const embedding of embeddings) {
		if (seen.has(embedding.retrievalTextSha256)) {
			throw new Error(`notice embedding data repeats retrieval text: ${embedding.retrievalTextSha256}`);
		}
		seen.add(embedding.retrievalTextSha256);
	}
	return { embeddings, manifest };
}

function parseDocsChunkSetManifest(value: unknown): DocsChunkSetManifest {
	if (
		!isRecord(value) ||
		value.schemaVersion !== DOCS_CHUNK_SET_SCHEMA_VERSION ||
		value.readerSchemaVersion !== DOCS_READER_SCHEMA_VERSION ||
		value.sourceSchemaVersion !== DOCS_SOURCE_SCHEMA_VERSION ||
		!isDeepStrictEqual(value.chunkDefinition, DOCS_CHUNK_DEFINITION) ||
		!positiveInteger(value.chunkCount) ||
		!positiveInteger(value.documentCount)
	) {
		throw new Error("Campus Docs chunk set manifest is invalid");
	}
	assertObjectReference(value.chunks, "Campus Docs chunk data");
	assertSha256Ref(String(value.sourceProjectionSha256 ?? ""), "Campus Docs source projection digest");
	return value as unknown as DocsChunkSetManifest;
}

function parseDocsEmbeddingSetManifest(value: unknown): DocsEmbeddingSetManifest {
	if (
		!isRecord(value) ||
		value.schemaVersion !== DOCS_EMBEDDING_SET_SCHEMA_VERSION ||
		!isDeepStrictEqual(value.embeddingSpace, EMBEDDING_SPACE) ||
		!positiveInteger(value.embeddingCount) ||
		!isModelTarget(value.modelTargetSha256)
	) {
		throw new Error("Campus Docs embedding set manifest is invalid");
	}
	assertSha256Ref(String(value.chunkSet ?? ""), "Campus Docs chunk set reference");
	assertObjectReference(value.embeddings, "Campus Docs embedding data");
	return value as unknown as DocsEmbeddingSetManifest;
}

function parseNoticeEmbeddingSetManifest(value: unknown): NoticeEmbeddingSetManifest {
	if (
		!isRecord(value) ||
		value.schemaVersion !== NOTICE_EMBEDDING_SET_SCHEMA_VERSION ||
		!isDeepStrictEqual(value.embeddingSpace, EMBEDDING_SPACE) ||
		!positiveInteger(value.embeddingCount) ||
		!isModelTarget(value.modelTargetSha256)
	) {
		throw new Error("notice embedding set manifest is invalid");
	}
	assertSha256Ref(String(value.chunkRun ?? ""), "notice chunk run reference");
	assertObjectReference(value.embeddings, "notice embedding data");
	return value as unknown as NoticeEmbeddingSetManifest;
}

function parseNoticeChunkRunManifest(value: unknown): NoticeChunkRunManifest {
	if (!isRecord(value) || value.schemaVersion !== NOTICE_CHUNK_RUN_SCHEMA_VERSION) {
		throw new Error("notice chunk run manifest schema is invalid");
	}
	if (
		!positiveInteger(value.chunkCount) ||
		!positiveInteger(value.noticeCount) ||
		!isRecord(value.definition) ||
		!nonEmptyString(value.definition.algorithm) ||
		!positiveInteger(value.definition.maxChars) ||
		!nonNegativeInteger(value.definition.overlapChars) ||
		!positiveInteger(value.definition.targetChars)
	) {
		throw new Error("notice chunk run manifest definition is invalid");
	}
	assertArtifactReference(value.chunks, "notice chunk data");
	assertArtifactReference(value.reviewSamples, "notice review samples");
	assertArtifactReference(value.validation, "notice chunk validation");
	return value as unknown as NoticeChunkRunManifest;
}

function parseDocsChunk(value: unknown, index: number): StoredDocsChunk {
	if (!isRecord(value)) throw new Error(`Campus Docs chunk record ${index} is invalid`);
	for (const field of [
		"chunkId",
		"content",
		"documentId",
		"documentTitle",
		"retrievalText",
		"sectionId",
		"sectionRef",
		"sectionTitle",
		"versionId",
		"versionSlug",
	] as const) {
		if (!nonEmptyString(value[field])) {
			throw new Error(`Campus Docs chunk record ${index} has invalid ${field}`);
		}
	}
	if (
		!Array.isArray(value.rootUnitIds) ||
		value.rootUnitIds.some((item) => !nonEmptyString(item))
	) {
		throw new Error(`Campus Docs chunk record ${index} has invalid rootUnitIds`);
	}
	assertSha256Ref(String(value.retrievalTextSha256 ?? ""), `Campus Docs chunk record ${index}`);
	return value as unknown as StoredDocsChunk;
}

function parseEmbedding(
	value: unknown,
	index: number,
	dimensions: number,
	source: string,
): StoredEmbedding {
	if (!isRecord(value)) throw new Error(`${source} embedding record ${index} is invalid`);
	assertSha256Ref(String(value.retrievalTextSha256 ?? ""), `${source} embedding record ${index}`);
	if (
		!Array.isArray(value.dense) ||
		value.dense.length !== dimensions ||
		value.dense.some((item) => typeof item !== "number" || !Number.isFinite(item))
	) {
		throw new Error(`${source} embedding record ${index} vector is invalid`);
	}
	return value as unknown as StoredEmbedding;
}

function decodeNoticeChunks(bytes: Uint8Array): NoticeChunk[] {
	const chunks = decodeNdjson(bytes, (value, index) => {
		if (!isRecord(value)) throw new Error(`notice chunk record ${index} is invalid`);
		for (const field of ["chunkId", "content", "noticeId", "retrievalText"] as const) {
			if (!nonEmptyString(value[field])) {
				throw new Error(`notice chunk record ${index} has invalid ${field}`);
			}
		}
		if (!isSha256Ref(value.chunkId) || !nonNegativeInteger(value.chunkIndex)) {
			throw new Error(`notice chunk record ${index} has invalid identity`);
		}
		if (
			!Array.isArray(value.headingPath) ||
			value.headingPath.some((heading) => !nonEmptyString(heading))
		) {
			throw new Error(`notice chunk record ${index} has invalid headingPath`);
		}
		return value as unknown as NoticeChunk;
	});
	const chunkIds = new Set<string>();
	for (const chunk of chunks) {
		if (chunkIds.has(chunk.chunkId)) {
			throw new Error(`notice chunk identity is duplicated: ${chunk.chunkId}`);
		}
		chunkIds.add(chunk.chunkId);
	}
	return chunks;
}

function groupNoticeChunks(chunks: readonly NoticeChunk[]): Map<string, NoticeChunk[]> {
	const grouped = new Map<string, NoticeChunk[]>();
	for (const chunk of chunks) {
		const values = grouped.get(chunk.noticeId) ?? [];
		values.push(chunk);
		grouped.set(chunk.noticeId, values);
	}
	for (const [noticeId, values] of grouped) {
		values.sort((left, right) => left.chunkIndex - right.chunkIndex);
		for (const [index, chunk] of values.entries()) {
			if (chunk.chunkIndex !== index) {
				throw new Error(`notice chunk indexes are not contiguous: ${noticeId}`);
			}
		}
	}
	return grouped;
}

async function readManifest<T>(
	store: ReaderObjectStore,
	key: string,
	id: Sha256Ref,
	parse: (value: unknown) => T,
): Promise<T> {
	const bytes = await store.read(key);
	if (sha256(bytes) !== id) throw new Error(`artifact manifest digest does not match ${id}`);
	const value = parseJson(bytes, "artifact manifest");
	if (!isCanonicalManifest(key, value, bytes)) {
		throw new Error(`artifact manifest is not canonical JSON: ${id}`);
	}
	return parse(value);
}

async function readVerifiedObject(
	store: ReaderObjectStore,
	ref: ObjectReference,
	label: string,
): Promise<Uint8Array> {
	const bytes = await store.read(ref.key);
	if (bytes.byteLength !== ref.byteSize) {
		throw new Error(`${label} byte size does not match ${ref.byteSize}`);
	}
	if (sha256(bytes) !== ref.sha256) {
		throw new Error(`${label} digest does not match ${ref.sha256}`);
	}
	return bytes;
}

function objectReferenceFromArtifact(prefix: string, ref: ArtifactReference): ObjectReference {
	return {
		byteSize: ref.byteSize,
		key: `${prefix}${prefix.endsWith("/") ? "" : "/"}${ref.file}`,
		sha256: ref.sha256,
	};
}

function assertArtifactReference(value: unknown, label: string): asserts value is ArtifactReference {
	if (
		!isRecord(value) ||
		!positiveInteger(value.byteSize) ||
		!nonEmptyString(value.file) ||
		!isSha256Ref(value.sha256)
	) {
		throw new Error(`${label} reference is invalid`);
	}
}

function assertObjectReference(value: unknown, label: string): asserts value is ObjectReference {
	if (
		!isRecord(value) ||
		!positiveInteger(value.byteSize) ||
		!nonEmptyString(value.key) ||
		!isSha256Ref(value.sha256)
	) {
		throw new Error(`${label} reference is invalid`);
	}
}

function decodeNdjson<T>(bytes: Uint8Array, parse: (value: unknown, index: number) => T): T[] {
	const records: T[] = [];
	let pending = "";
	let recordIndex = 0;
	for (let offset = 0; offset < bytes.byteLength; offset += 64 * 1024) {
		pending += decoder.decode(bytes.subarray(offset, offset + 64 * 1024), { stream: true });
		let newlineIndex = pending.indexOf("\n");
		while (newlineIndex >= 0) {
			const line = pending.slice(0, newlineIndex);
			pending = pending.slice(newlineIndex + 1);
			if (line === "") throw new Error("content-addressed NDJSON contains an empty record");
			try {
				records.push(parse(JSON.parse(line) as unknown, recordIndex));
			} catch (error) {
				if (error instanceof Error && /(?:record|projection|chunk|embedding)/u.test(error.message)) {
					throw error;
				}
				throw new Error(`NDJSON record ${recordIndex} is not valid JSON`, { cause: error });
			}
			recordIndex += 1;
			newlineIndex = pending.indexOf("\n");
		}
	}
	pending += decoder.decode();
	if (pending !== "") throw new Error("content-addressed NDJSON must end with a newline");
	if (recordIndex === 0) throw new Error("content-addressed NDJSON contains no records");
	return records;
}

function canonicalJsonBytes(value: unknown): Uint8Array {
	return encoder.encode(`${JSON.stringify(sortJson(value))}\n`);
}

function isCanonicalManifest(key: string, value: unknown, bytes: Uint8Array): boolean {
	const compact = canonicalJsonBytes(value);
	if (Buffer.from(compact).equals(Buffer.from(bytes))) return true;
	if (key.startsWith("campus-docs/rag/")) {
		const pretty = encoder.encode(`${JSON.stringify(sortJson(value), undefined, 2)}\n`);
		return Buffer.from(pretty).equals(Buffer.from(bytes));
	}
	return false;
}

function parseJson(bytes: Uint8Array, label: string): unknown {
	try {
		return JSON.parse(decoder.decode(bytes)) as unknown;
	} catch (error) {
		throw new Error(`${label} is not valid UTF-8 JSON`, { cause: error });
	}
}

function sha256(value: Uint8Array | string): Sha256Ref {
	return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function sortJson(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortJson);
	if (!isRecord(value)) return value;
	return Object.fromEntries(
		Object.entries(value)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, child]) => [key, sortJson(child)]),
	);
}

function isSha256Ref(value: unknown): value is Sha256Ref {
	return typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
}

function isModelTarget(value: unknown): value is string {
	return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function nonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim() !== "";
}

function positiveInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function nonNegativeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
