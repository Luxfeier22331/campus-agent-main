import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { artifactHex } from "./run-reader.ts";
import { sha256 } from "./encoding.ts";
import { decodeNoticeQuestionNdjson } from "./embedding-evaluation-inputs.ts";
import {
	NOTICE_EMBEDDING_EVALUATION_SCHEMA_VERSION,
	type EmbeddingEvaluationManifest,
	type NoticeEmbeddingEvaluationArtifact,
	type NoticeEmbeddingEvaluationMetrics,
	type NoticeQuestionRanking,
} from "./embedding-evaluation-model.ts";
import type { ArtifactReference, Sha256Ref } from "./types.ts";

export async function readNoticeEmbeddingEvaluation(
	artifactRoot: string,
	evaluationRun: Sha256Ref,
): Promise<NoticeEmbeddingEvaluationArtifact> {
	assertSha256Ref(evaluationRun, "notice embedding evaluation run");
	const directory = join(
		artifactRoot,
		"notices",
		"chunking",
		"embedding-evaluations",
		"sha256",
		artifactHex(evaluationRun),
	);
	const manifestBytes = await readFile(join(directory, "manifest.json"));
	if (sha256(manifestBytes) !== evaluationRun) {
		throw new Error(`notice embedding evaluation manifest digest does not match ${evaluationRun}`);
	}
	const manifestValue = parseJson(manifestBytes, "notice embedding evaluation manifest");
	if (!isRecord(manifestValue) || manifestValue.schemaVersion !== NOTICE_EMBEDDING_EVALUATION_SCHEMA_VERSION) {
		throw new Error("notice embedding evaluation manifest schema is invalid");
	}
	const manifest = manifestValue as unknown as EmbeddingEvaluationManifest;
	if (
		!positiveInteger(manifest.chunkCount) ||
		!positiveInteger(manifest.embeddingInputCount) ||
		!positiveInteger(manifest.questionCount) ||
		!isSha256Ref(manifest.chunkRun) ||
		!/^[0-9a-f]{64}$/u.test(manifest.modelTargetSha256)
	) {
		throw new Error("notice embedding evaluation manifest definition is invalid");
	}
	assertArtifactReference(manifest.metrics, "notice embedding evaluation metrics");
	assertArtifactReference(manifest.questions, "notice embedding evaluation questions");
	assertArtifactReference(manifest.rankings, "notice embedding evaluation rankings");
	const metricsBytes = await readVerifiedFile(
		directory,
		manifest.metrics,
		"notice embedding evaluation metrics",
	);
	const questionBytes = await readVerifiedFile(
		directory,
		manifest.questions,
		"notice embedding evaluation questions",
	);
	const rankingBytes = await readVerifiedFile(
		directory,
		manifest.rankings,
		"notice embedding evaluation rankings",
	);
	const metricsValue = parseJson(metricsBytes, "notice embedding evaluation metrics");
	if (
		!isRecord(metricsValue) ||
		metricsValue.schemaVersion !== "notice_embedding_evaluation_metrics.v1"
	) {
		throw new Error("notice embedding evaluation metrics schema is invalid");
	}
	const metrics = metricsValue as unknown as NoticeEmbeddingEvaluationMetrics;
	const questions = decodeNoticeQuestionNdjson(questionBytes);
	const rankings = decodeRankingNdjson(rankingBytes);
	if (questions.length !== manifest.questionCount || rankings.length !== manifest.questionCount) {
		throw new Error("notice embedding evaluation question count does not match the manifest");
	}
	if (rankings.some((ranking, index) => ranking.questionId !== questions[index]?.questionId)) {
		throw new Error("notice embedding evaluation ranking order does not match questions");
	}
	return { evaluationRun, manifest, metrics, questions, rankings };
}

function decodeRankingNdjson(bytes: Uint8Array): NoticeQuestionRanking[] {
	return decodeNdjson(bytes, (value, index) => {
		if (!isRecord(value)) throw new Error(`notice ranking record ${index} is invalid`);
		for (const field of ["answer", "noticeId", "question", "questionId", "stratum"] as const) {
			if (!nonEmptyString(value[field])) {
				throw new Error(`notice ranking record ${index} has invalid ${field}`);
			}
		}
		if (!Array.isArray(value.topChunks)) {
			throw new Error(`notice ranking record ${index} has invalid topChunks`);
		}
		return value as unknown as NoticeQuestionRanking;
	});
}

async function readVerifiedFile(
	directory: string,
	ref: ArtifactReference,
	label: string,
): Promise<Uint8Array> {
	const bytes = await readFile(join(directory, ref.file));
	if (bytes.byteLength !== ref.byteSize) {
		throw new Error(`${label} byte size does not match ${ref.byteSize}`);
	}
	if (sha256(bytes) !== ref.sha256) {
		throw new Error(`${label} digest does not match ${ref.sha256}`);
	}
	return bytes;
}

function decodeNdjson<T>(
	bytes: Uint8Array,
	parse: (value: unknown, index: number) => T,
): T[] {
	const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	if (!text.endsWith("\n")) throw new Error("notice evaluation NDJSON must end with a newline");
	const lines = text.slice(0, -1).split("\n");
	if (lines.some((line) => line === "")) {
		throw new Error("notice evaluation NDJSON contains an empty record");
	}
	return lines.map((line, index) => parse(JSON.parse(line) as unknown, index));
}

function parseJson(bytes: Uint8Array, label: string): unknown {
	try {
		return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
	} catch (error) {
		throw new Error(`${label} is not valid UTF-8 JSON`, { cause: error });
	}
}

function assertArtifactReference(value: unknown, label: string): asserts value is ArtifactReference {
	if (
		!isRecord(value) ||
		!positiveInteger(value.byteSize) ||
		!nonEmptyString(value.file) ||
		!nonEmptyString(value.sha256)
	) {
		throw new Error(`${label} reference is invalid`);
	}
	assertSha256Ref(value.sha256, `${label} digest`);
}

function assertSha256Ref(value: string, label: string): asserts value is Sha256Ref {
	if (!/^sha256:[0-9a-f]{64}$/u.test(value)) {
		throw new Error(`${label} must be sha256:<64 lowercase hex characters>`);
	}
}

function isSha256Ref(value: unknown): value is Sha256Ref {
	return typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
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
