import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import type { EmbeddingClient } from "@campus-agent/embedding-runtime";

import { writeImmutable } from "../artifacts.ts";
import {
	buildEmbeddingInputSet,
	decodeNoticeQuestionNdjson,
	assertQuestionEvidence,
} from "./inputs.ts";
import {
	NOTICE_EMBEDDING_EVALUATION_DEFINITION,
	NOTICE_EMBEDDING_EVALUATION_SCHEMA_VERSION,
	type EmbeddingEvaluationManifest,
	type NoticeEmbeddingEvaluationResult,
} from "./model.ts";
import { evaluateDenseRetrieval } from "./ranking.ts";
import { assertNoticeEmbeddingModelTargetSha256, resolveNoticeEmbeddingVectors } from "../embedding-cache.ts";
import { canonicalJsonBytes, encodeNdjson, sha256 } from "../encoding.ts";
import { artifactHex, readNoticeChunkRun } from "../run-reader.ts";
import type { ArtifactReference, Sha256Ref } from "../types.ts";

export async function runLocalNoticeEmbeddingEvaluation(input: {
	artifactRoot: string;
	chunkRun: Sha256Ref;
	embedding: EmbeddingClient;
	modelTargetSha256: string;
	onEmbeddingProgress?: (completedInputCount: number, totalInputCount: number) => void;
	onRankingProgress?: (completedQuestionCount: number, totalQuestionCount: number) => void;
	questionFile: string;
}): Promise<NoticeEmbeddingEvaluationResult> {
	assertNoticeEmbeddingModelTargetSha256(input.modelTargetSha256);
	const chunkRun = await readNoticeChunkRun(input.artifactRoot, input.chunkRun);
	const { chunks, manifest: chunkManifest } = chunkRun;
	const questionBytes = await readFile(input.questionFile);
	const questions = decodeNoticeQuestionNdjson(questionBytes);
	assertQuestionEvidence(chunks, questions);
	const embeddingInputs = buildEmbeddingInputSet(chunks, questions);
	const resolved = await resolveNoticeEmbeddingVectors({
		artifactRoot: input.artifactRoot,
		embedding: input.embedding,
		modelTargetSha256: input.modelTargetSha256,
		...(input.onEmbeddingProgress ? { onProgress: input.onEmbeddingProgress } : {}),
		textBySha256: embeddingInputs.textBySha256,
	});
	const documentVectorsByChunkId = new Map<Sha256Ref, number[]>();
	for (const [chunkId, textSha256] of embeddingInputs.documentTextByChunkId) {
		const vector = resolved.vectorsByTextSha256.get(textSha256);
		if (!vector) throw new Error(`embedding vector is missing for chunk ${chunkId}`);
		documentVectorsByChunkId.set(chunkId, vector);
	}
	const queryVectorsByQuestionId = new Map<string, number[]>();
	for (const [questionId, textSha256] of embeddingInputs.queryTextByQuestionId) {
		const vector = resolved.vectorsByTextSha256.get(textSha256);
		if (!vector) throw new Error(`embedding vector is missing for question ${questionId}`);
		queryVectorsByQuestionId.set(questionId, vector);
	}
	const { metrics, rankings } = evaluateDenseRetrieval({
		chunks,
		documentVectorsByChunkId,
		...(input.onRankingProgress ? { onProgress: input.onRankingProgress } : {}),
		questions,
		queryVectorsByQuestionId,
	});
	const metricsBytes = canonicalJsonBytes(metrics);
	const rankingBytes = encodeNdjson(rankings);
	const manifest: EmbeddingEvaluationManifest = {
		chunkCount: chunks.length,
		chunkDefinition: chunkManifest.definition,
		chunkRun: input.chunkRun,
		definition: NOTICE_EMBEDDING_EVALUATION_DEFINITION,
		embeddingInputCount: embeddingInputs.textBySha256.size,
		metrics: reference("metrics.json", metricsBytes),
		modelTargetSha256: input.modelTargetSha256,
		questionCount: questions.length,
		questions: reference("questions.ndjson", questionBytes),
		rankings: reference("rankings.ndjson", rankingBytes),
		schemaVersion: NOTICE_EMBEDDING_EVALUATION_SCHEMA_VERSION,
	};
	const manifestBytes = canonicalJsonBytes(manifest);
	const run = sha256(manifestBytes);
	const outputDirectory = join(
		input.artifactRoot,
		"notices",
		"chunking",
		"embedding-evaluations",
		"sha256",
		artifactHex(run),
	);
	await mkdir(outputDirectory, { recursive: true });
	await Promise.all([
		writeImmutable(join(outputDirectory, "manifest.json"), manifestBytes),
		writeImmutable(join(outputDirectory, "metrics.json"), metricsBytes),
		writeImmutable(join(outputDirectory, "questions.ndjson"), questionBytes),
		writeImmutable(join(outputDirectory, "rankings.ndjson"), rankingBytes),
	]);
	return {
		generatedEmbeddingInputCount: resolved.generatedInputCount,
		metrics,
		outputDirectory,
		reusedEmbeddingInputCount: resolved.reusedInputCount,
		run,
	};
}

function reference(file: string, bytes: Uint8Array): ArtifactReference {
	return { byteSize: bytes.byteLength, file, sha256: sha256(bytes) };
}
