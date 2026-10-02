import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
	NOTICE_CHUNK_RUN_SCHEMA_VERSION,
	type NoticeChunkDefinition,
} from "./definitions.ts";
import { canonicalJsonBytes, encodeNdjson, sha256 } from "./encoding.ts";
import type {
	LocalChunkRunResult,
	NoticeArtifactStore,
	NoticeChunk,
	NoticeChunkRunManifest,
	NoticeChunkValidationReport,
	NoticeReviewSample,
	ObjectReference,
	StoredNoticeChunksResult,
} from "./types.ts";

interface EncodedChunkRun {
	chunkBytes: Uint8Array;
	manifestBytes: Uint8Array;
	reviewBytes: Uint8Array;
	run: `sha256:${string}`;
	validationBytes: Uint8Array;
}

export async function writeLocalChunkRun(input: {
	artifactRoot: string;
	chunks: readonly NoticeChunk[];
	definition: NoticeChunkDefinition;
	reviewSamples: readonly NoticeReviewSample[];
	validation: NoticeChunkValidationReport;
}): Promise<LocalChunkRunResult> {
	const encoded = encodeChunkRun(input);
	const outputDirectory = join(
		input.artifactRoot,
		"notices",
		"chunking",
		"sha256",
		encoded.run.slice("sha256:".length),
	);
	await mkdir(outputDirectory, { recursive: true });
	await Promise.all([
		writeImmutable(join(outputDirectory, "chunks.ndjson"), encoded.chunkBytes),
		writeImmutable(join(outputDirectory, "manifest.json"), encoded.manifestBytes),
		writeImmutable(join(outputDirectory, "review-samples.ndjson"), encoded.reviewBytes),
		writeImmutable(join(outputDirectory, "validation.json"), encoded.validationBytes),
	]);
	return {
		chunkCount: input.chunks.length,
		noticeCount: input.validation.noticeCount,
		outputDirectory,
		run: encoded.run,
	};
}

export async function writeStoredNoticeChunks(input: {
	artifactStore: NoticeArtifactStore;
	chunks: readonly NoticeChunk[];
}): Promise<StoredNoticeChunksResult> {
	const bytes = encodeNdjson(input.chunks);
	const digest = sha256(bytes);
	const chunks: ObjectReference = {
		key: noticeChunkDataKey(digest),
		byteSize: bytes.byteLength,
		sha256: digest,
	};
	await input.artifactStore.writeImmutable(chunks.key, bytes);
	return {
		chunks,
		chunkCount: input.chunks.length,
		noticeCount: new Set(input.chunks.map((chunk) => chunk.noticeId)).size,
	};
}

export function noticeChunkDataKey(digest: `sha256:${string}`): string {
	return `notices/rag/chunk-data/sha256/${digest.slice(7)}/chunks.ndjson`;
}

function encodeChunkRun(input: {
	chunks: readonly NoticeChunk[];
	definition: NoticeChunkDefinition;
	reviewSamples: readonly NoticeReviewSample[];
	validation: NoticeChunkValidationReport;
}): EncodedChunkRun {
	const chunkBytes = encodeNdjson(input.chunks);
	const validationBytes = canonicalJsonBytes(input.validation);
	const reviewBytes = encodeNdjson(input.reviewSamples);
	const manifest: NoticeChunkRunManifest = {
		chunkCount: input.chunks.length,
		chunks: reference("chunks.ndjson", chunkBytes),
		definition: input.definition,
		noticeCount: input.validation.noticeCount,
		reviewSamples: reference("review-samples.ndjson", reviewBytes),
		schemaVersion: NOTICE_CHUNK_RUN_SCHEMA_VERSION,
		validation: reference("validation.json", validationBytes),
	};
	const manifestBytes = canonicalJsonBytes(manifest);
	return {
		chunkBytes,
		manifestBytes,
		reviewBytes,
		run: sha256(manifestBytes),
		validationBytes,
	};
}

function reference(file: string, bytes: Uint8Array) {
	return { byteSize: bytes.byteLength, file, sha256: sha256(bytes) };
}

export async function writeImmutable(path: string, bytes: Uint8Array): Promise<void> {
	try {
		await writeFile(path, bytes, { flag: "wx" });
		return;
	} catch (error) {
		if (!isFileExistsError(error)) {
			throw error;
		}
	}
	const existing = await readFile(path);
	if (!existing.equals(Buffer.from(bytes))) {
		throw new Error(`local notice chunk artifact conflicts: ${path}`);
	}
}

function isFileExistsError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error && error.code === "EEXIST";
}
