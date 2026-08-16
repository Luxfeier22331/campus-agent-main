import { isDeepStrictEqual } from "node:util";

import {
	canonicalJsonBytes,
	sha256,
} from "../../../apps/campus-web/src/docs-reader-build/source-catalog.ts";
import type { ObjectRef } from "../../../apps/campus-web/src/docs-reader-build/source-types.ts";
import {
	INDEX_DEFINITION,
	type ArtifactObjectStore,
	type ChunkSetManifest,
	type EmbeddingSetManifest,
	type IndexManifest,
	type ReaderObjectStore,
	type Sha256Ref,
	type StoredChunk,
	type StoredEmbedding,
} from "./types.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export function assertSha256Ref(value: string, label: string): Sha256Ref {
	if (!/^sha256:[a-f0-9]{64}$/u.test(value)) {
		throw new Error(`${label} must be sha256:<64 lowercase hex characters>`);
	}
	return value as Sha256Ref;
}

export function artifactHex(value: Sha256Ref): string {
	return value.slice("sha256:".length);
}

export function chunkDataKey(digest: Sha256Ref): string {
	return `campus-docs/rag/chunk-data/sha256/${artifactHex(digest)}/chunks.ndjson`;
}

export function chunkSetManifestKey(id: Sha256Ref): string {
	return `campus-docs/rag/chunk-sets/sha256/${artifactHex(id)}/manifest.json`;
}

export function embeddingDataKey(digest: Sha256Ref): string {
	return `campus-docs/rag/embedding-data/sha256/${artifactHex(digest)}/embeddings.ndjson`;
}

export function embeddingSetManifestKey(id: Sha256Ref): string {
	return `campus-docs/rag/embedding-sets/sha256/${artifactHex(id)}/manifest.json`;
}

export function indexManifestKey(id: Sha256Ref): string {
	return `campus-docs/rag/indexes/sha256/${artifactHex(id)}/manifest.json`;
}

export function encodeNDJSON(records: readonly unknown[]): Uint8Array {
	if (records.length === 0) throw new Error("content-addressed NDJSON must contain at least one record");
	return encoder.encode(`${records.map((record) => JSON.stringify(sortJSON(record))).join("\n")}\n`);
}

export function decodeChunkNDJSON(bytes: Uint8Array): StoredChunk[] {
	return decodeNDJSON(bytes, parseStoredChunk);
}

export function decodeEmbeddingNDJSON(bytes: Uint8Array): StoredEmbedding[] {
	return decodeNDJSON(bytes, parseStoredEmbedding);
}

export async function writeChunkData(
	store: ArtifactObjectStore,
	records: readonly StoredChunk[],
): Promise<ObjectRef> {
	const bytes = encodeNDJSON(records);
	return writeData(store, chunkDataKey, bytes);
}

export async function writeEmbeddingData(
	store: ArtifactObjectStore,
	records: readonly StoredEmbedding[],
): Promise<ObjectRef> {
	const bytes = encodeNDJSON(records);
	return writeData(store, embeddingDataKey, bytes);
}

export async function writeChunkSetManifest(
	store: ArtifactObjectStore,
	manifest: ChunkSetManifest,
): Promise<Sha256Ref> {
	return writeManifest(store, chunkSetManifestKey, manifest);
}

export async function writeEmbeddingSetManifest(
	store: ArtifactObjectStore,
	manifest: EmbeddingSetManifest,
): Promise<Sha256Ref> {
	return writeManifest(store, embeddingSetManifestKey, manifest);
}

export async function writeIndexManifest(
	store: ArtifactObjectStore,
	manifest: IndexManifest,
): Promise<Sha256Ref> {
	return writeManifest(store, indexManifestKey, manifest);
}

export async function readChunkSet(
	store: ReaderObjectStore,
	id: Sha256Ref,
): Promise<{ chunks: StoredChunk[]; manifest: ChunkSetManifest }> {
	const manifest = await readManifest(store, id, chunkSetManifestKey, parseChunkSetManifest);
	const bytes = await readVerifiedRef(store, manifest.chunks, "chunk data");
	const chunks = decodeChunkNDJSON(bytes);
	if (chunks.length !== manifest.chunkCount) {
		throw new Error(`chunk data count = ${chunks.length}, want ${manifest.chunkCount}`);
	}
	return { chunks, manifest };
}

export async function readEmbeddingSet(
	store: ReaderObjectStore,
	id: Sha256Ref,
): Promise<{ embeddings: StoredEmbedding[]; manifest: EmbeddingSetManifest }> {
	const manifest = await readManifest(store, id, embeddingSetManifestKey, parseEmbeddingSetManifest);
	const bytes = await readVerifiedRef(store, manifest.embeddings, "embedding data");
	const embeddings = decodeEmbeddingNDJSON(bytes);
	if (embeddings.length !== manifest.embeddingCount) {
		throw new Error(`embedding data count = ${embeddings.length}, want ${manifest.embeddingCount}`);
	}
	return { embeddings, manifest };
}

async function writeData(
	store: ArtifactObjectStore,
	keyForDigest: (digest: Sha256Ref) => string,
	bytes: Uint8Array,
): Promise<ObjectRef> {
	const digest = sha256(bytes);
	const key = keyForDigest(digest);
	await store.writeImmutable(key, bytes);
	return { byteSize: bytes.byteLength, key, sha256: digest };
}

async function writeManifest(
	store: ArtifactObjectStore,
	keyForDigest: (digest: Sha256Ref) => string,
	manifest: unknown,
): Promise<Sha256Ref> {
	const bytes = canonicalJsonBytes(manifest);
	const id = sha256(bytes);
	await store.writeImmutable(keyForDigest(id), bytes);
	return id;
}

async function readManifest<T>(
	store: ReaderObjectStore,
	id: Sha256Ref,
	keyForID: (id: Sha256Ref) => string,
	parse: (value: unknown) => T,
): Promise<T> {
	const bytes = await store.read(keyForID(id));
	if (sha256(bytes) !== id) throw new Error(`artifact manifest digest does not match ${id}`);
	const value = parseJSON(bytes, "artifact manifest");
	if (!Buffer.from(canonicalJsonBytes(value)).equals(Buffer.from(bytes))) {
		throw new Error(`artifact manifest is not canonical JSON: ${id}`);
	}
	return parse(value);
}

async function readVerifiedRef(
	store: ReaderObjectStore,
	ref: ObjectRef,
	label: string,
): Promise<Uint8Array> {
	const bytes = await store.read(ref.key);
	if (bytes.byteLength !== ref.byteSize) {
		throw new Error(`${label} byte size = ${bytes.byteLength}, want ${ref.byteSize}`);
	}
	if (sha256(bytes) !== ref.sha256) throw new Error(`${label} digest does not match ${ref.sha256}`);
	return bytes;
}

function decodeNDJSON<T>(bytes: Uint8Array, parse: (value: unknown, index: number) => T): T[] {
	const text = decoder.decode(bytes);
	if (!text.endsWith("\n")) throw new Error("content-addressed NDJSON must end with a newline");
	const lines = text.slice(0, -1).split("\n");
	if (lines.some((line) => line === "")) throw new Error("content-addressed NDJSON contains an empty record");
	return lines.map((line, index) => parse(parseJSON(encoder.encode(line), `NDJSON record ${index}`), index));
}

function parseChunkSetManifest(value: unknown): ChunkSetManifest {
	if (!isRecord(value) || value.schemaVersion !== "campus_docs_chunk_set.v1") {
		throw new Error("chunk set manifest schema is invalid");
	}
	const manifest = value as unknown as ChunkSetManifest;
	if (
		manifest.readerSchemaVersion !== INDEX_DEFINITION.readerSchemaVersion ||
		manifest.sourceSchemaVersion !== INDEX_DEFINITION.sourceSchemaVersion ||
		!isDeepStrictEqual(manifest.chunkDefinition, INDEX_DEFINITION.chunking) ||
		!positiveInteger(manifest.chunkCount) ||
		!positiveInteger(manifest.documentCount)
	) {
		throw new Error("chunk set manifest definition is invalid");
	}
	assertObjectRef(manifest.source, "chunk set source");
	assertObjectRef(manifest.chunks, "chunk set data");
	assertSha256Ref(manifest.sourceProjectionSha256, "source projection digest");
	return manifest;
}

function parseEmbeddingSetManifest(value: unknown): EmbeddingSetManifest {
	if (!isRecord(value) || value.schemaVersion !== "campus_docs_embedding_set.v1") {
		throw new Error("embedding set manifest schema is invalid");
	}
	const manifest = value as unknown as EmbeddingSetManifest;
	if (
		!isDeepStrictEqual(manifest.embeddingDefinition, INDEX_DEFINITION.embedding) ||
		!positiveInteger(manifest.embeddingCount)
	) {
		throw new Error("embedding set manifest definition is invalid");
	}
	assertSha256Ref(manifest.chunkSet, "embedding set chunk reference");
	assertObjectRef(manifest.embeddings, "embedding set data");
	return manifest;
}

function parseStoredChunk(value: unknown, index: number): StoredChunk {
	if (!isRecord(value)) throw new Error(`chunk record ${index} is invalid`);
	const stringFields = [
		"chunkId", "content", "documentId", "documentTitle", "retrievalText", "retrievalTextSha256",
		"sectionId", "sectionRef", "sectionTitle", "versionId", "versionLabel", "versionSlug",
	] as const;
	if (stringFields.some((field) => typeof value[field] !== "string" || !value[field])) {
		throw new Error(`chunk record ${index} has an invalid string field`);
	}
	if (!Array.isArray(value.rootUnitIds) || value.rootUnitIds.some((item) => typeof item !== "string" || !item)) {
		throw new Error(`chunk record ${index} root unit ids are invalid`);
	}
	assertSha256Ref(value.retrievalTextSha256 as string, `chunk record ${index} retrieval text digest`);
	return value as unknown as StoredChunk;
}

function parseStoredEmbedding(value: unknown, index: number): StoredEmbedding {
	if (!isRecord(value)) throw new Error(`embedding record ${index} is invalid`);
	assertSha256Ref(String(value.retrievalTextSha256 ?? ""), `embedding record ${index} retrieval text digest`);
	if (
		!Array.isArray(value.dense) ||
		value.dense.length !== INDEX_DEFINITION.embedding.dimensions ||
		value.dense.some((item) => typeof item !== "number" || !Number.isFinite(item))
	) {
		throw new Error(`embedding record ${index} vector is invalid`);
	}
	return value as unknown as StoredEmbedding;
}

function assertObjectRef(value: unknown, label: string): asserts value is ObjectRef {
	if (!isRecord(value) || !positiveInteger(value.byteSize) || typeof value.key !== "string" || !value.key) {
		throw new Error(`${label} object reference is invalid`);
	}
	assertSha256Ref(String(value.sha256 ?? ""), `${label} digest`);
}

function parseJSON(bytes: Uint8Array, label: string): unknown {
	try {
		return JSON.parse(decoder.decode(bytes));
	} catch (error) {
		throw new Error(`${label} is not valid UTF-8 JSON`, { cause: error });
	}
}

function sortJSON(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortJSON);
	if (!isRecord(value)) return value;
	return Object.fromEntries(
		Object.entries(value)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, item]) => [key, sortJSON(item)]),
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function positiveInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
