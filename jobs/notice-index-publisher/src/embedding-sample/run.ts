import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { EMBEDDING_SPACE, type EmbeddingClient } from "@campus-agent/embedding-runtime";

import { writeImmutable } from "../artifacts.ts";
import {
	NOTICE_EMBEDDING_CACHE_SCHEMA_VERSION,
	assertNoticeEmbeddingModelTargetSha256,
	resolveNoticeEmbeddingVectors,
} from "../embedding-cache.ts";
import { canonicalJsonBytes, sha256 } from "../encoding.ts";
import {
	NOTICE_EMBEDDING_SAMPLE_REPORT_SCHEMA_VERSION,
	type LocalNoticeEmbeddingSampleResult,
	type NoticeEmbeddingSampleReport,
	type NoticeEmbeddingSampleStatus,
} from "./model.ts";
import { buildNoticeEmbeddingSampleManifest } from "./artifacts.ts";
import { selectNoticeEmbeddingSample } from "./selection.ts";
import { artifactHex, readNoticeChunkRun } from "../run-reader.ts";
import type { Sha256Ref } from "../types.ts";

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
	const textBySha256 = new Map(
		selection.records.map((record) => [record.retrievalTextSha256, record.retrievalText]),
	);

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
	// Reused vectors were parsed and checked while resolving; generated ones were checked at the provider boundary.
	const statuses = selection.records.map<NoticeEmbeddingSampleStatus>((record) => ({
		cacheStatus: resolved.generatedTextSha256s.has(record.retrievalTextSha256)
			? "generated"
			: "reused",
		chunkId: record.chunkId,
		retrievalTextSha256: record.retrievalTextSha256,
	}));
	const report: NoticeEmbeddingSampleReport = {
		cacheSchemaVersion: NOTICE_EMBEDDING_CACHE_SCHEMA_VERSION,
		chunkRun: input.chunkRun,
		embeddingSpace: EMBEDDING_SPACE,
		generatedEmbeddingInputCount: resolved.generatedInputCount,
		modelTargetSha256: input.modelTargetSha256,
		reusedEmbeddingInputCount: resolved.reusedInputCount,
		sampleRun: run,
		schemaVersion: NOTICE_EMBEDDING_SAMPLE_REPORT_SCHEMA_VERSION,
		selectedChunkCount: selection.records.length,
		statuses,
		strata: selection.strata,
		uniqueEmbeddingInputCount: textBySha256.size,
		vectorDimensions: EMBEDDING_SPACE.dimensions,
	};
	const reportBytes = canonicalJsonBytes(report);
	const reportRun = sha256(reportBytes);
	const reportDirectory = join(outputDirectory, "reports", "sha256");
	const reportPath = join(reportDirectory, `${artifactHex(reportRun)}.json`);
	await mkdir(reportDirectory, { recursive: true });
	await writeImmutable(reportPath, reportBytes);
	return {
		generatedEmbeddingInputCount: resolved.generatedInputCount,
		outputDirectory,
		report,
		reportPath,
		reportRun,
		reusedEmbeddingInputCount: resolved.reusedInputCount,
		run,
		selectedChunkCount: selection.records.length,
		uniqueEmbeddingInputCount: textBySha256.size,
	};
}
