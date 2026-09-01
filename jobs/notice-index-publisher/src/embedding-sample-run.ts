import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { EMBEDDING_SPACE, type EmbeddingClient } from "@campus-agent/embedding-runtime";

import { writeImmutable } from "./artifacts.ts";
import {
	NOTICE_EMBEDDING_CACHE_SCHEMA_VERSION,
	assertNoticeEmbeddingModelTargetSha256,
	noticeEmbeddingCachePath,
	parseCachedNoticeEmbedding,
	resolveNoticeEmbeddingVectors,
} from "./embedding-cache.ts";
import { canonicalJsonBytes, sha256 } from "./encoding.ts";
import {
	NOTICE_EMBEDDING_SAMPLE_REPORT_MANIFEST_SCHEMA_VERSION,
	NOTICE_EMBEDDING_SAMPLE_REPORT_SCHEMA_VERSION,
	type LocalNoticeEmbeddingSampleResult,
	type NoticeEmbeddingSampleReport,
	type NoticeEmbeddingSampleReportManifest,
	type NoticeEmbeddingSampleStatus,
} from "./embedding-sample-model.ts";
import { buildNoticeEmbeddingSampleManifest } from "./embedding-sample-artifacts.ts";
import { selectNoticeEmbeddingSample } from "./embedding-sample-selection.ts";
import { artifactHex, readNoticeChunkRun } from "./run-reader.ts";
import type { ArtifactReference, Sha256Ref } from "./types.ts";

export async function runLocalNoticeEmbeddingSample(input: {
	artifactRoot: string;
	chunkRun: Sha256Ref;
	embedding: EmbeddingClient;
	modelTargetSha256: string;
	onEmbeddingProgress?: (completedInputCount: number, totalInputCount: number) => void;
}): Promise<LocalNoticeEmbeddingSampleResult> {
	assertNoticeEmbeddingModelTargetSha256(input.modelTargetSha256);
	const runData = await readNoticeChunkRun(input.artifactRoot, input.chunkRun);
	const selection = selectNoticeEmbeddingSample({
		chunks: runData.chunks,
		chunksByNoticeId: runData.chunksByNoticeId,
	});
	const chunksById = new Map(runData.chunks.map((chunk) => [chunk.chunkId, chunk]));
	const textBySha256 = new Map<Sha256Ref, string>();
	for (const record of selection.records) {
		const chunk = chunksById.get(record.chunkId);
		if (!chunk) throw new Error(`notice embedding sample references missing chunk ${record.chunkId}`);
		if (record.retrievalText !== chunk.retrievalText) {
			throw new Error(`notice embedding sample retrieval text differs: ${record.chunkId}`);
		}
		if (record.retrievalTextSha256 !== sha256(record.retrievalText)) {
			throw new Error(`notice embedding sample retrieval text hash is invalid: ${record.chunkId}`);
		}
		const existing = textBySha256.get(record.retrievalTextSha256);
		if (existing !== undefined && existing !== record.retrievalText) {
			throw new Error(`notice embedding text SHA-256 collision: ${record.retrievalTextSha256}`);
		}
		textBySha256.set(record.retrievalTextSha256, record.retrievalText);
	}

	const sampleArtifact = buildNoticeEmbeddingSampleManifest({
		chunkDefinition: runData.manifest.definition,
		chunkRun: input.chunkRun,
		modelTargetSha256: input.modelTargetSha256,
		records: selection.records,
	});
	const { manifestBytes, run, sampleBytes } = sampleArtifact;
	const outputDirectory = join(
		input.artifactRoot,
		"notices",
		"chunking",
		"embedding-samples",
		"sha256",
		artifactHex(run),
	);
	await mkdir(outputDirectory, { recursive: true });
	await Promise.all([
		writeImmutable(join(outputDirectory, "manifest.json"), manifestBytes),
		writeImmutable(join(outputDirectory, "sample.ndjson"), sampleBytes),
	]);

	const resolved = await resolveNoticeEmbeddingVectors({
		artifactRoot: input.artifactRoot,
		embedding: input.embedding,
		modelTargetSha256: input.modelTargetSha256,
		...(input.onEmbeddingProgress ? { onProgress: input.onEmbeddingProgress } : {}),
		textBySha256,
	});
	for (const textSha256 of textBySha256.keys()) {
		const cacheBytes = await readFile(
			noticeEmbeddingCachePath(input.artifactRoot, input.modelTargetSha256, textSha256),
		);
		parseCachedNoticeEmbedding(cacheBytes, textSha256, input.modelTargetSha256);
	}
	const statuses = selection.records.map<NoticeEmbeddingSampleStatus>((record) => ({
		cacheStatus: resolved.generatedTextSha256s.has(record.retrievalTextSha256)
			? "generated"
			: "reused",
		chunkId: record.chunkId,
		retrievalTextSha256: record.retrievalTextSha256,
		valid: true,
	}));
	const report: NoticeEmbeddingSampleReport = {
		cacheValidation: {
			canonicalJsonPassed: true,
			embeddingSpacePassed: true,
			modelTargetPassed: true,
			schemaPassed: true,
			textSha256Passed: true,
		},
		cacheSchemaVersion: NOTICE_EMBEDDING_CACHE_SCHEMA_VERSION,
		chunkRun: input.chunkRun,
		embeddingSpace: EMBEDDING_SPACE,
		finiteValuesPassed: true,
		generatedEmbeddingInputCount: resolved.generatedInputCount,
		modelTargetSha256: input.modelTargetSha256,
		nonZeroNormPassed: true,
		passed: true,
		reusedEmbeddingInputCount: resolved.reusedInputCount,
		sampleRun: run,
		schemaVersion: NOTICE_EMBEDDING_SAMPLE_REPORT_SCHEMA_VERSION,
		selectedChunkCount: selection.records.length,
		statuses,
		strata: selection.strata,
		uniqueEmbeddingInputCount: textBySha256.size,
		vectorDimensions: EMBEDDING_SPACE.dimensions,
		vectorDimensionsPassed: true,
	};
	const reportBytes = canonicalJsonBytes(report);
	const reportManifest: NoticeEmbeddingSampleReportManifest = {
		modelTargetSha256: input.modelTargetSha256,
		report: reference("report.json", reportBytes),
		sampleRun: run,
		schemaVersion: NOTICE_EMBEDDING_SAMPLE_REPORT_MANIFEST_SCHEMA_VERSION,
	};
	const reportManifestBytes = canonicalJsonBytes(reportManifest);
	const reportRun = sha256(reportManifestBytes);
	const reportDirectory = join(outputDirectory, "reports", "sha256", artifactHex(reportRun));
	await mkdir(reportDirectory, { recursive: true });
	await Promise.all([
		writeImmutable(join(reportDirectory, "manifest.json"), reportManifestBytes),
		writeImmutable(join(reportDirectory, "report.json"), reportBytes),
	]);
	return {
		generatedEmbeddingInputCount: resolved.generatedInputCount,
		outputDirectory,
		report,
		reportDirectory,
		reportRun,
		reusedEmbeddingInputCount: resolved.reusedInputCount,
		run,
		selectedChunkCount: selection.records.length,
		uniqueEmbeddingInputCount: textBySha256.size,
	};
}

function reference(file: string, bytes: Uint8Array): ArtifactReference {
	return { byteSize: bytes.byteLength, file, sha256: sha256(bytes) };
}
