import { isDeepStrictEqual } from "node:util";

import { EMBEDDING_SPACE, embedTexts } from "@campus-agent/embedding-runtime";

import { assertValidNoticeEmbeddingVector } from "./embedding-cache.ts";
import { canonicalJsonBytes, encodeNdjson, sha256 } from "./encoding.ts";
import { readStoredNoticeChunkRun } from "./run-reader.ts";
import type {
	BuildNoticeEmbeddingSetInput,
	BuildNoticeEmbeddingSetResult,
	NoticeArtifactReader,
	NoticeEmbeddingSetData,
	NoticeEmbeddingSetManifest,
	ObjectReference,
	Sha256Ref,
	StoredNoticeEmbedding,
} from "./types.ts";

export async function buildNoticeEmbeddingSet(
	input: BuildNoticeEmbeddingSetInput,
): Promise<BuildNoticeEmbeddingSetResult> {
	assertModelTarget(input.modelTargetSha256);
	const chunkRun = await readStoredNoticeChunkRun(input.artifactStore, input.chunkRun);
	const textBySha256 = new Map<Sha256Ref, string>();
	for (const chunk of chunkRun.chunks) {
		const digest = sha256(chunk.retrievalText);
		const existing = textBySha256.get(digest);
		if (existing !== undefined && existing !== chunk.retrievalText) {
			throw new Error(`notice retrieval text SHA-256 collision: ${digest}`);
		}
		textBySha256.set(digest, chunk.retrievalText);
	}
	const inputs = [...textBySha256].sort(([left], [right]) => left.localeCompare(right));
	const vectors = await embedTexts(
		input.embedding,
		inputs.map(([, text]) => text),
		input.onEmbeddingProgress,
	);
	const embeddings = inputs.map<StoredNoticeEmbedding>(([retrievalTextSha256], index) => {
		const dense = vectors[index];
		if (!dense) throw new Error(`notice embedding result is missing: ${retrievalTextSha256}`);
		assertValidNoticeEmbeddingVector(dense, retrievalTextSha256);
		return { dense, retrievalTextSha256 };
	});
	const embeddingBytes = encodeNdjson(embeddings);
	const embeddingDigest = sha256(embeddingBytes);
	const embeddingKey = noticeEmbeddingDataKey(embeddingDigest);
	await input.artifactStore.writeImmutable(embeddingKey, embeddingBytes);
	const manifest: NoticeEmbeddingSetManifest = {
		chunkRun: input.chunkRun,
		embeddingCount: embeddings.length,
		embeddingSpace: EMBEDDING_SPACE,
		embeddings: reference(embeddingKey, embeddingBytes),
		modelTargetSha256: input.modelTargetSha256,
		schemaVersion: "notice_embedding_set.v1",
	};
	const manifestBytes = canonicalJsonBytes(manifest);
	const embeddingSet = sha256(manifestBytes);
	await input.artifactStore.writeImmutable(
		noticeEmbeddingSetManifestKey(embeddingSet),
		manifestBytes,
	);
	return { embeddingCount: embeddings.length, embeddingSet };
}

export async function readNoticeEmbeddingSet(
	store: NoticeArtifactReader,
	id: Sha256Ref,
): Promise<NoticeEmbeddingSetData> {
	assertSha256Ref(id, "notice embedding set");
	const manifestBytes = await store.read(noticeEmbeddingSetManifestKey(id));
	if (sha256(manifestBytes) !== id) {
		throw new Error(`notice embedding set manifest digest does not match ${id}`);
	}
	const value = parseJson(manifestBytes, "notice embedding set manifest");
	if (!isRecord(value) || value.schemaVersion !== "notice_embedding_set.v1") {
		throw new Error("notice embedding set manifest schema is invalid");
	}
	const manifest = value as unknown as NoticeEmbeddingSetManifest;
	assertSha256Ref(manifest.chunkRun, "notice embedding chunk run");
	assertModelTarget(manifest.modelTargetSha256);
	if (
		!positiveInteger(manifest.embeddingCount) ||
		!isDeepStrictEqual(manifest.embeddingSpace, EMBEDDING_SPACE)
	) {
		throw new Error("notice embedding set manifest definition is invalid");
	}
	assertObjectReference(manifest.embeddings, "notice embedding data");
	const bytes = await store.read(manifest.embeddings.key);
	if (
		bytes.byteLength !== manifest.embeddings.byteSize ||
		sha256(bytes) !== manifest.embeddings.sha256
	) {
		throw new Error("notice embedding data reference does not match its object");
	}
	const embeddings = decodeEmbeddings(bytes, manifest.embeddingCount);
	return { embeddings, manifest };
}

export function noticeEmbeddingDataKey(digest: Sha256Ref): string {
	return `notices/rag/embedding-data/sha256/${artifactHex(digest)}/embeddings.ndjson`;
}

export function noticeEmbeddingSetManifestKey(id: Sha256Ref): string {
	return `notices/rag/embedding-sets/sha256/${artifactHex(id)}/manifest.json`;
}

function decodeEmbeddings(bytes: Uint8Array, expectedCount: number): StoredNoticeEmbedding[] {
	const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	if (!text.endsWith("\n")) throw new Error("notice embedding NDJSON must end with a newline");
	const lines = text.slice(0, -1).split("\n");
	if (lines.length !== expectedCount || lines.some((line) => line === "")) {
		throw new Error("notice embedding data count does not match its manifest");
	}
	const seen = new Set<Sha256Ref>();
	return lines.map((line, index) => {
		let value: unknown;
		try {
			value = JSON.parse(line) as unknown;
		} catch (error) {
			throw new Error(`notice embedding record ${index} is not valid JSON`, { cause: error });
		}
		if (!isRecord(value)) throw new Error(`notice embedding record ${index} is invalid`);
		assertSha256Ref(value.retrievalTextSha256, `notice embedding record ${index}`);
		assertValidNoticeEmbeddingVector(value.dense, value.retrievalTextSha256);
		if (seen.has(value.retrievalTextSha256)) {
			throw new Error(`notice embedding data repeats retrieval text: ${value.retrievalTextSha256}`);
		}
		seen.add(value.retrievalTextSha256);
		return value as unknown as StoredNoticeEmbedding;
	});
}

function reference(key: string, bytes: Uint8Array): ObjectReference {
	return { byteSize: bytes.byteLength, key, sha256: sha256(bytes) };
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

function assertModelTarget(value: string): void {
	if (!/^[0-9a-f]{64}$/u.test(value)) {
		throw new Error("notice embedding model target SHA-256 is invalid");
	}
}

function assertSha256Ref(value: unknown, label: string): asserts value is Sha256Ref {
	if (!isSha256Ref(value)) throw new Error(`${label} must be sha256:<64 lowercase hex characters>`);
}

function isSha256Ref(value: unknown): value is Sha256Ref {
	return typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
}

function artifactHex(value: Sha256Ref): string {
	return value.slice("sha256:".length);
}

function parseJson(bytes: Uint8Array, label: string): unknown {
	try {
		return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
	} catch (error) {
		throw new Error(`${label} is not valid UTF-8 JSON`, { cause: error });
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function nonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim() !== "";
}

function positiveInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value > 0;
}
