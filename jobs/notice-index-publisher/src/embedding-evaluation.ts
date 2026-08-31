import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import {
	CANONICAL_EMBEDDING_MODEL,
	EMBEDDING_SPACE,
	type EmbeddingClient,
} from "@campus-agent/embedding-runtime";

import { canonicalJsonBytes, encodeNdjson, sha256 } from "./encoding.ts";
import { writeImmutable } from "./artifacts.ts";
import {
	assertNoticeEmbeddingModelTargetSha256,
	resolveNoticeEmbeddingVectors,
} from "./embedding-cache.ts";
import { artifactHex, readNoticeChunkRun } from "./run-reader.ts";
import type { ArtifactReference, NoticeChunk, Sha256Ref } from "./types.ts";

export const NOTICE_QUERY_INSTRUCTION =
	"Given a Campus Web notice question, retrieve relevant notice passages that answer the query.";

export const NOTICE_EMBEDDING_EVALUATION_DEFINITION = {
	embeddingSpace: EMBEDDING_SPACE,
	model: CANONICAL_EMBEDDING_MODEL,
	queryInstruction: NOTICE_QUERY_INSTRUCTION,
	rankingCutoffs: [1, 3, 5, 10],
	rankingDepth: 10,
	similarity: "cosine",
} as const;

const EVALUATION_SCHEMA_VERSION = "notice_embedding_evaluation_run.v1" as const;

type RankingCutoff = (typeof NOTICE_EMBEDDING_EVALUATION_DEFINITION.rankingCutoffs)[number];
type RankingCutoffKey = `${RankingCutoff}`;

export interface NoticeQuestionEvidence {
	chunkId?: Sha256Ref;
	text: string;
}

export interface NoticeRetrievalQuestion {
	answer: string;
	evidence: NoticeQuestionEvidence[];
	noticeId: string;
	question: string;
	questionId: string;
	stratum: string;
}

export interface RankedNoticeChunk {
	chunkId: Sha256Ref;
	chunkIndex: number;
	content: string;
	headingPath: string[];
	noticeId: string;
	rank: number;
	score: number;
}

export interface NoticeQuestionRanking {
	allEvidenceRank: number;
	answer: string;
	answerEvidenceRank: number;
	evidenceChunkIds: Sha256Ref[];
	evidenceChunkRanks: Record<string, number>;
	firstEvidenceRank: number;
	firstNoticeRank: number;
	noticeId: string;
	question: string;
	questionId: string;
	singleChunkAnswerRank: number | null;
	stratum: string;
	topChunks: RankedNoticeChunk[];
}

export interface RetrievalMetricSlice {
	allEvidenceRecallAt: Record<RankingCutoffKey, number>;
	answerEvidenceRecallAt: Record<RankingCutoffKey, number>;
	meanAnswerReciprocalRank: number;
	meanNoticeReciprocalRank: number;
	meanReciprocalRank: number;
	meanSingleChunkAnswerReciprocalRank: number;
	noticeRecallAt: Record<RankingCutoffKey, number>;
	questionCount: number;
	singleChunkAnswerQuestionCount: number;
	singleChunkAnswerRecallAt: Record<RankingCutoffKey, number>;
	targetChunkRecallAt: Record<RankingCutoffKey, number>;
}

export interface NoticeEmbeddingEvaluationMetrics extends RetrievalMetricSlice {
	byStratum: Record<string, RetrievalMetricSlice>;
	chunkCount: number;
	definition: typeof NOTICE_EMBEDDING_EVALUATION_DEFINITION;
	multiChunkEvidenceQuestionCount: number;
	schemaVersion: "notice_embedding_evaluation_metrics.v1";
	singleChunkEvidenceQuestionCount: number;
}

export interface NoticeEmbeddingEvaluationResult {
	generatedEmbeddingInputCount: number;
	metrics: NoticeEmbeddingEvaluationMetrics;
	outputDirectory: string;
	reusedEmbeddingInputCount: number;
	run: Sha256Ref;
}

export interface EmbeddingEvaluationManifest {
	chunkCount: number;
	chunkDefinition: {
		algorithm: string;
		maxChars: number;
		overlapChars: number;
		targetChars: number;
	};
	chunkRun: Sha256Ref;
	definition: typeof NOTICE_EMBEDDING_EVALUATION_DEFINITION;
	embeddingInputCount: number;
	metrics: ArtifactReference;
	modelTargetSha256: string;
	questionCount: number;
	questions: ArtifactReference;
	rankings: ArtifactReference;
	schemaVersion: typeof EVALUATION_SCHEMA_VERSION;
}

export interface NoticeEmbeddingEvaluationArtifact {
	evaluationRun: Sha256Ref;
	manifest: EmbeddingEvaluationManifest;
	metrics: NoticeEmbeddingEvaluationMetrics;
	questions: NoticeRetrievalQuestion[];
	rankings: NoticeQuestionRanking[];
}

interface EmbeddingInputSet {
	documentTextByChunkId: Map<Sha256Ref, Sha256Ref>;
	queryTextByQuestionId: Map<string, Sha256Ref>;
	textBySha256: Map<Sha256Ref, string>;
}

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
		schemaVersion: EVALUATION_SCHEMA_VERSION,
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
	if (!isRecord(manifestValue) || manifestValue.schemaVersion !== EVALUATION_SCHEMA_VERSION) {
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

export function formatNoticeQuery(question: string): string {
	const value = question.trim();
	if (!value) throw new Error("notice retrieval question is required");
	return `Instruct: ${NOTICE_QUERY_INSTRUCTION}\nQuery:${value}`;
}

export function evaluateDenseRetrieval(input: {
	chunks: readonly NoticeChunk[];
	documentVectorsByChunkId: ReadonlyMap<Sha256Ref, readonly number[]>;
	onProgress?: (completedQuestionCount: number, totalQuestionCount: number) => void;
	questions: readonly NoticeRetrievalQuestion[];
	queryVectorsByQuestionId: ReadonlyMap<string, readonly number[]>;
}): { metrics: NoticeEmbeddingEvaluationMetrics; rankings: NoticeQuestionRanking[] } {
	if (input.chunks.length === 0) throw new Error("dense retrieval evaluation requires chunks");
	if (input.questions.length === 0) throw new Error("dense retrieval evaluation requires questions");
	const denseChunks = input.chunks.map((chunk) => {
		const vector = input.documentVectorsByChunkId.get(chunk.chunkId);
		if (!vector) throw new Error(`dense vector is missing for chunk ${chunk.chunkId}`);
		return { chunk, norm: vectorNorm(vector), vector };
	});
	const rankings: NoticeQuestionRanking[] = [];
	for (const [questionIndex, question] of input.questions.entries()) {
		const queryVector = input.queryVectorsByQuestionId.get(question.questionId);
		if (!queryVector) {
			throw new Error(`dense vector is missing for question ${question.questionId}`);
		}
		const queryNorm = vectorNorm(queryVector);
		const scored = denseChunks
			.map(({ chunk, norm, vector }) => ({
				chunk,
				score: cosineSimilarity(queryVector, queryNorm, vector, norm),
			}))
			.sort(
				(left, right) =>
					right.score - left.score || left.chunk.chunkId.localeCompare(right.chunk.chunkId),
			);
		const targetEvidence = question.evidence.map((evidence) =>
			bestRankedChunk(
				scored,
				evidence.chunkId
					? (chunk) => chunk.chunkId === evidence.chunkId
					: (chunk) =>
							chunk.noticeId === question.noticeId && chunk.content.includes(evidence.text),
			),
		);
		const answerEvidenceRanks = question.evidence.map(
			(evidence) =>
				bestRankedChunk(
					scored,
					(chunk) =>
						chunk.noticeId === question.noticeId && chunk.content.includes(evidence.text),
				).rank,
		);
		const evidenceChunkRanks = Object.fromEntries(
			targetEvidence.map(({ chunk, rank }) => [chunk.chunkId, rank]),
		);
		const evidenceChunkIds = [...new Set(targetEvidence.map(({ chunk }) => chunk.chunkId))];
		const evidenceRanks = targetEvidence.map(({ rank }) => rank);
		const firstNoticeRank = scored.findIndex((item) => item.chunk.noticeId === question.noticeId) + 1;
		if (firstNoticeRank === 0) {
			throw new Error(`notice ${question.noticeId} is missing from dense ranking`);
		}
		rankings.push({
			allEvidenceRank: Math.max(...evidenceRanks),
			answer: question.answer,
			answerEvidenceRank: Math.max(...answerEvidenceRanks),
			evidenceChunkIds,
			evidenceChunkRanks,
			firstEvidenceRank: Math.min(...evidenceRanks),
			firstNoticeRank,
			noticeId: question.noticeId,
			question: question.question,
			questionId: question.questionId,
			singleChunkAnswerRank: singleChunkAnswerRank(scored, question),
			stratum: question.stratum,
			topChunks: scored
				.slice(0, NOTICE_EMBEDDING_EVALUATION_DEFINITION.rankingDepth)
				.map(({ chunk, score }, rankIndex) => ({
					chunkId: chunk.chunkId,
					chunkIndex: chunk.chunkIndex,
					content: chunk.content,
					headingPath: chunk.headingPath,
					noticeId: chunk.noticeId,
					rank: rankIndex + 1,
					score: round(score, 8),
				})),
		});
		input.onProgress?.(questionIndex + 1, input.questions.length);
	}
	const overall = summarizeNoticeRetrievalRankings(rankings);
	const strata = [...new Set(rankings.map((ranking) => ranking.stratum))].sort();
	const byStratum = Object.fromEntries(
		strata.map((stratum) => [
			stratum,
			summarizeNoticeRetrievalRankings(
				rankings.filter((ranking) => ranking.stratum === stratum),
			),
		]),
	);
	const singleChunkEvidenceQuestionCount = rankings.filter(
		(ranking) => ranking.evidenceChunkIds.length === 1,
	).length;
	return {
		metrics: {
			...overall,
			byStratum,
			chunkCount: input.chunks.length,
			definition: NOTICE_EMBEDDING_EVALUATION_DEFINITION,
			multiChunkEvidenceQuestionCount:
				rankings.length - singleChunkEvidenceQuestionCount,
			schemaVersion: "notice_embedding_evaluation_metrics.v1",
			singleChunkEvidenceQuestionCount,
		},
		rankings,
	};
}

export function decodeNoticeQuestionNdjson(bytes: Uint8Array): NoticeRetrievalQuestion[] {
	const seenQuestionIds = new Set<string>();
	return decodeNdjson(bytes, (value, index) => {
		if (!isRecord(value)) throw new Error(`notice question record ${index} is invalid`);
		for (const field of ["answer", "noticeId", "question", "questionId", "stratum"] as const) {
			if (!nonEmptyString(value[field])) {
				throw new Error(`notice question record ${index} has invalid ${field}`);
			}
		}
		if (seenQuestionIds.has(value.questionId as string)) {
			throw new Error(`notice question id is duplicated: ${value.questionId as string}`);
		}
		seenQuestionIds.add(value.questionId as string);
		if (!Array.isArray(value.evidence) || value.evidence.length === 0) {
			throw new Error(`notice question record ${index} has no evidence`);
		}
		for (const [evidenceIndex, evidence] of value.evidence.entries()) {
			if (!isRecord(evidence) || !nonEmptyString(evidence.text)) {
				throw new Error(
					`notice question record ${index} evidence ${evidenceIndex} is invalid`,
				);
			}
			if (evidence.chunkId !== undefined) {
				if (!nonEmptyString(evidence.chunkId)) {
					throw new Error(
						`notice question record ${index} evidence ${evidenceIndex} chunk id is invalid`,
					);
				}
				assertSha256Ref(
					evidence.chunkId,
					`notice question record ${index} evidence ${evidenceIndex} chunk id`,
				);
			}
		}
		return value as unknown as NoticeRetrievalQuestion;
	});
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

export function assertQuestionEvidence(
	chunks: readonly NoticeChunk[],
	questions: readonly NoticeRetrievalQuestion[],
): void {
	const chunksById = new Map(chunks.map((chunk) => [chunk.chunkId, chunk]));
	for (const question of questions) {
		for (const evidence of question.evidence) {
			if (evidence.chunkId) {
				const annotatedChunk = chunksById.get(evidence.chunkId);
				if (!annotatedChunk) {
					throw new Error(
						`question ${question.questionId} references missing chunk ${evidence.chunkId}`,
					);
				}
				if (
					annotatedChunk.noticeId !== question.noticeId ||
					!annotatedChunk.content.includes(evidence.text)
				) {
					throw new Error(
						`question ${question.questionId} annotated evidence does not match ${annotatedChunk.chunkId}`,
					);
				}
			}
			if (
				!chunks.some(
					(chunk) =>
						chunk.noticeId === question.noticeId && chunk.content.includes(evidence.text),
				)
			) {
				throw new Error(
					`question ${question.questionId} evidence text is missing from notice ${question.noticeId}`,
				);
			}
		}
	}
}

function buildEmbeddingInputSet(
	chunks: readonly NoticeChunk[],
	questions: readonly NoticeRetrievalQuestion[],
): EmbeddingInputSet {
	const textBySha256 = new Map<Sha256Ref, string>();
	const addText = (text: string): Sha256Ref => {
		const digest = sha256(text);
		const existing = textBySha256.get(digest);
		if (existing !== undefined && existing !== text) {
			throw new Error(`embedding text SHA-256 collision: ${digest}`);
		}
		textBySha256.set(digest, text);
		return digest;
	};
	const documentTextByChunkId = new Map<Sha256Ref, Sha256Ref>();
	for (const chunk of chunks) {
		documentTextByChunkId.set(chunk.chunkId, addText(chunk.retrievalText));
	}
	const queryTextByQuestionId = new Map<string, Sha256Ref>();
	for (const question of questions) {
		queryTextByQuestionId.set(question.questionId, addText(formatNoticeQuery(question.question)));
	}
	return { documentTextByChunkId, queryTextByQuestionId, textBySha256 };
}

export function summarizeNoticeRetrievalRankings(
	rankings: readonly NoticeQuestionRanking[],
): RetrievalMetricSlice {
	if (rankings.length === 0) throw new Error("retrieval metric slice requires rankings");
	const singleChunkAnswerRankings = rankings.filter(
		(ranking) => ranking.singleChunkAnswerRank !== null,
	);
	return {
		allEvidenceRecallAt: cutoffRecord((cutoff) =>
			fraction(rankings, (ranking) => ranking.allEvidenceRank <= cutoff),
		),
		answerEvidenceRecallAt: cutoffRecord((cutoff) =>
			fraction(rankings, (ranking) => ranking.answerEvidenceRank <= cutoff),
		),
		meanAnswerReciprocalRank: round(
			rankings.reduce((sum, ranking) => sum + 1 / ranking.answerEvidenceRank, 0) /
				rankings.length,
			6,
		),
		meanNoticeReciprocalRank: round(
			rankings.reduce((sum, ranking) => sum + 1 / ranking.firstNoticeRank, 0) /
				rankings.length,
			6,
		),
		meanReciprocalRank: round(
			rankings.reduce((sum, ranking) => sum + 1 / ranking.firstEvidenceRank, 0) /
				rankings.length,
			6,
		),
		meanSingleChunkAnswerReciprocalRank: round(
			singleChunkAnswerRankings.length === 0
				? 0
				: singleChunkAnswerRankings.reduce(
						(sum, ranking) => sum + 1 / ranking.singleChunkAnswerRank!,
						0,
					) / singleChunkAnswerRankings.length,
			6,
		),
		noticeRecallAt: cutoffRecord((cutoff) =>
			fraction(rankings, (ranking) => ranking.firstNoticeRank <= cutoff),
		),
		questionCount: rankings.length,
		singleChunkAnswerQuestionCount: singleChunkAnswerRankings.length,
		singleChunkAnswerRecallAt: cutoffRecord((cutoff) =>
			singleChunkAnswerRankings.length === 0
				? 0
				: fraction(singleChunkAnswerRankings, (ranking) => ranking.singleChunkAnswerRank! <= cutoff),
		),
		targetChunkRecallAt: cutoffRecord((cutoff) =>
			fraction(rankings, (ranking) => ranking.firstEvidenceRank <= cutoff),
		),
	};
}

function cutoffRecord(
	valueFor: (cutoff: RankingCutoff) => number,
): Record<RankingCutoffKey, number> {
	return Object.fromEntries(
		NOTICE_EMBEDDING_EVALUATION_DEFINITION.rankingCutoffs.map((cutoff) => [
			String(cutoff),
			valueFor(cutoff),
		]),
	) as Record<RankingCutoffKey, number>;
}

function fraction<T>(items: readonly T[], predicate: (item: T) => boolean): number {
	return round(items.filter(predicate).length / items.length, 6);
}

function bestRankedChunk(
	scored: readonly { chunk: NoticeChunk; score: number }[],
	matches: (chunk: NoticeChunk) => boolean,
): { chunk: NoticeChunk; rank: number } {
	const index = scored.findIndex((item) => matches(item.chunk));
	const item = scored[index];
	if (index < 0 || !item) throw new Error("evidence text is missing from dense ranking");
	return { chunk: item.chunk, rank: index + 1 };
}

function singleChunkAnswerRank(
	scored: readonly { chunk: NoticeChunk; score: number }[],
	question: NoticeRetrievalQuestion,
): number | null {
	const index = scored.findIndex((item) =>
		item.chunk.noticeId === question.noticeId &&
		question.evidence.every((evidence) => item.chunk.content.includes(evidence.text)),
	);
	return index < 0 ? null : index + 1;
}

function cosineSimilarity(
	left: readonly number[],
	leftNorm: number,
	right: readonly number[],
	rightNorm: number,
): number {
	if (left.length !== right.length) {
		throw new Error(`dense vector dimensions differ: ${left.length} and ${right.length}`);
	}
	let dot = 0;
	for (let index = 0; index < left.length; index += 1) {
		dot += left[index]! * right[index]!;
	}
	return dot / (leftNorm * rightNorm);
}

function vectorNorm(vector: readonly number[]): number {
	if (vector.length === 0 || vector.some((value) => !Number.isFinite(value))) {
		throw new Error("dense vector is invalid");
	}
	const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
	if (!Number.isFinite(norm) || norm === 0) throw new Error("dense vector norm is invalid");
	return norm;
}

function reference(file: string, bytes: Uint8Array): ArtifactReference {
	return { byteSize: bytes.byteLength, file, sha256: sha256(bytes) };
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

function round(value: number, digits: number): number {
	return Number(value.toFixed(digits));
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
