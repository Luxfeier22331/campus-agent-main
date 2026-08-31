import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
	NOTICE_CHUNK_RUN_SCHEMA_VERSION,
	type NoticeChunkDefinition,
} from "./definitions.ts";
import { canonicalJsonBytes, encodeNdjson, sha256 } from "./encoding.ts";
import type {
	LocalChunkRunResult,
	NoticeChunk,
	NoticeChunkRunManifest,
	NoticeChunkValidationReport,
	NoticeReviewSample,
} from "./types.ts";

export async function writeLocalChunkRun(input: {
	artifactRoot: string;
	chunks: readonly NoticeChunk[];
	definition: NoticeChunkDefinition;
	reviewSamples: readonly NoticeReviewSample[];
	validation: NoticeChunkValidationReport;
}): Promise<LocalChunkRunResult> {
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
	const run = sha256(manifestBytes);
	const outputDirectory = join(
		input.artifactRoot,
		"notices",
		"chunking",
		"sha256",
		run.slice("sha256:".length),
	);
	await mkdir(outputDirectory, { recursive: true });
	await Promise.all([
		writeImmutable(join(outputDirectory, "chunks.ndjson"), chunkBytes),
		writeImmutable(join(outputDirectory, "manifest.json"), manifestBytes),
		writeImmutable(join(outputDirectory, "review-samples.ndjson"), reviewBytes),
		writeImmutable(join(outputDirectory, "validation.json"), validationBytes),
	]);
	return {
		chunkCount: input.chunks.length,
		noticeCount: input.validation.noticeCount,
		outputDirectory,
		run,
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
