import { ArtifactValidationError } from "@campus-agent/embedding-runtime";
import { createHash } from "node:crypto";
import { mkdtemp, open, rm } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EMBEDDING_SPACE } from "@campus-agent/embedding-runtime";

import {
	assertNoticeEmbeddingModelTargetSha256,
	assertValidNoticeEmbeddingVector,
	collectNoticeEmbeddingInputs,
	resolveStoredNoticeEmbeddingCache,
	sortNoticeEmbeddingInputs,
} from "./embedding-cache.ts";
import { canonicalJsonBytes, sha256 } from "./encoding.ts";
import { readStoredNoticeChunks } from "./run-reader.ts";
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
	assertNoticeEmbeddingModelTargetSha256(input.modelTargetSha256);
	const chunkData = await readStoredNoticeChunks(input.artifactStore, input.chunks);
	const inputs = sortNoticeEmbeddingInputs(collectNoticeEmbeddingInputs(chunkData.chunks));
	const resolved = await resolveStoredNoticeEmbeddingCache({
		artifactStore: input.artifactStore,
		embedding: input.embedding,
		modelTargetSha256: input.modelTargetSha256,
		...(input.onEmbeddingProgress ? { onProgress: input.onEmbeddingProgress } : {}),
		textBySha256: new Map(inputs),
	});
	const tempDirectory = await mkdtemp(join(tmpdir(), "notice-embedding-set-"));
	const tempPath = join(tempDirectory, "embeddings.ndjson");
	let fileHandle: FileHandle | undefined;
	try {
		fileHandle = await open(tempPath, "wx");
		const digest = createHash("sha256");
		let byteSize = 0;
		let embeddingCount = 0;
		for (const [retrievalTextSha256] of inputs) {
			const dense = resolved.vectorsByTextSha256.get(retrievalTextSha256);
			if (!dense) {
				throw new ArtifactValidationError(`notice embedding cache is missing ${retrievalTextSha256}`);
			}
			const recordBytes = canonicalJsonBytes({
				dense,
				retrievalTextSha256,
			});
			await writeAll(fileHandle, recordBytes);
			digest.update(recordBytes);
			byteSize += recordBytes.byteLength;
			embeddingCount += 1;
		}
		await fileHandle.close();
		fileHandle = undefined;

		const embeddingDigest = `sha256:${digest.digest("hex")}` as Sha256Ref;
		const embeddingKey = noticeEmbeddingDataKey(embeddingDigest);
		await input.artifactStore.writeImmutableFile(embeddingKey, {
			byteSize,
			path: tempPath,
			sha256: embeddingDigest,
		});
		const manifest: NoticeEmbeddingSetManifest = {
			chunks: chunkData.reference,
			embeddingCount,
			embeddingSpace: EMBEDDING_SPACE,
			embeddings: reference(embeddingKey, byteSize, embeddingDigest),
			modelTargetSha256: input.modelTargetSha256,
			schemaVersion: "notice_embedding_set.v2",
		};
		const manifestBytes = canonicalJsonBytes(manifest);
		const embeddingSet = sha256(manifestBytes);
		await input.artifactStore.writeImmutable(
			noticeEmbeddingSetManifestKey(embeddingSet),
			manifestBytes,
		);
		return {
			embeddingCount,
			embeddingSet,
			generatedEmbeddingInputCount: resolved.generatedInputCount,
			reusedEmbeddingInputCount: resolved.reusedInputCount,
		};
	} finally {
		if (fileHandle) await fileHandle.close();
		await rm(tempDirectory, { force: true, recursive: true });
	}
}

export async function readNoticeEmbeddingSet(
	store: NoticeArtifactReader,
	id: Sha256Ref,
): Promise<NoticeEmbeddingSetData> {
	assertSha256Ref(id, "notice embedding set");
	const manifestBytes = await store.read(noticeEmbeddingSetManifestKey(id));
	if (sha256(manifestBytes) !== id) {
		throw new ArtifactValidationError(`notice embedding set manifest digest does not match ${id}`);
	}
	const value = parseJson(manifestBytes, "notice embedding set manifest");
	if (!isRecord(value) || (value.schemaVersion !== "notice_embedding_set.v1" && value.schemaVersion !== "notice_embedding_set.v2")) {
		throw new ArtifactValidationError("notice embedding set manifest schema is invalid");
	}
	const manifest = value as unknown as NoticeEmbeddingSetManifest;
	if (manifest.schemaVersion === "notice_embedding_set.v1") {
		assertSha256Ref(manifest.chunkRun, "notice embedding chunk run");
	} else {
		assertObjectReference(manifest.chunks, "notice chunk data");
	}
	assertNoticeEmbeddingModelTargetSha256(manifest.modelTargetSha256);
	if (
		!positiveInteger(manifest.embeddingCount) ||
		!isDeepStrictEqual(manifest.embeddingSpace, EMBEDDING_SPACE)
	) {
		throw new ArtifactValidationError("notice embedding set manifest definition is invalid");
	}
	assertObjectReference(manifest.embeddings, "notice embedding data");
	const bytes = await store.read(manifest.embeddings.key);
	if (
		bytes.byteLength !== manifest.embeddings.byteSize ||
		sha256(bytes) !== manifest.embeddings.sha256
	) {
		throw new ArtifactValidationError("notice embedding data reference does not match its object");
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
	// A published set can exceed V8's single-string limit. Decode one record at
	// a time; the verified bytes and resulting vectors need no full text copy.
	const decoder = new TextDecoder("utf-8", { fatal: true });
	const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (data.at(-1) !== 10) throw new ArtifactValidationError("notice embedding NDJSON must end with a newline");
	const seen = new Set<Sha256Ref>();
	const result: StoredNoticeEmbedding[] = [];
	for (let start = 0; start < data.length;) {
		const end = data.indexOf(10, start);
		if (end === start || result.length >= expectedCount) {
			throw new ArtifactValidationError("notice embedding data count does not match its manifest");
		}
		const line = decoder.decode(data.subarray(start, end));
		start = end + 1;
		const index = result.length;
		let value: unknown;
		try {
			value = JSON.parse(line) as unknown;
		} catch (error) {
			throw new ArtifactValidationError(`notice embedding record ${index} is not valid JSON`, { cause: error });
		}
		if (!isRecord(value)) throw new ArtifactValidationError(`notice embedding record ${index} is invalid`);
		assertSha256Ref(value.retrievalTextSha256, `notice embedding record ${index}`);
		assertValidNoticeEmbeddingVector(value.dense, value.retrievalTextSha256);
		if (seen.has(value.retrievalTextSha256)) {
			throw new ArtifactValidationError(`notice embedding data repeats retrieval text: ${value.retrievalTextSha256}`);
		}
		seen.add(value.retrievalTextSha256);
		result.push(value as unknown as StoredNoticeEmbedding);
	}
	if (result.length !== expectedCount) throw new ArtifactValidationError("notice embedding data count does not match its manifest");
	return result;
}

function reference(key: string, byteSize: number, digest: Sha256Ref): ObjectReference {
	return { byteSize, key, sha256: digest };
}

async function writeAll(fileHandle: FileHandle, bytes: Uint8Array): Promise<void> {
	let offset = 0;
	while (offset < bytes.byteLength) {
		const result = await fileHandle.write(bytes, offset, bytes.byteLength - offset);
		if (result.bytesWritten <= 0) throw new ArtifactValidationError("notice embedding data file write made no progress");
		offset += result.bytesWritten;
	}
}

function assertObjectReference(value: unknown, label: string): asserts value is ObjectReference {
	if (
		!isRecord(value) ||
		!positiveInteger(value.byteSize) ||
		!nonEmptyString(value.key) ||
		!isSha256Ref(value.sha256)
	) {
		throw new ArtifactValidationError(`${label} reference is invalid`);
	}
}

function assertSha256Ref(value: unknown, label: string): asserts value is Sha256Ref {
	if (!isSha256Ref(value)) throw new ArtifactValidationError(`${label} must be sha256:<64 lowercase hex characters>`);
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
		throw new ArtifactValidationError(`${label} is not valid UTF-8 JSON`, { cause: error });
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
