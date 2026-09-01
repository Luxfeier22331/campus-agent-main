import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import {
	artifactHex,
	CAMPUS_DOCS_CHUNK_GOVERNANCE_ROOT,
	decodeGovernanceNdjson,
	encodeGovernanceNdjson,
	readGovernanceChunkSet,
	readVerifiedGovernanceFile,
	reference,
	writeImmutableGovernanceFile,
} from "./chunk-governance-artifacts.ts";
import {
	CAMPUS_DOCS_CHUNK_EMBEDDING_CACHE_SCHEMA_VERSION,
	CAMPUS_DOCS_CHUNK_EMBEDDING_EVALUATION_SCHEMA_VERSION,
	CAMPUS_DOCS_CHUNK_EMBEDDING_METRICS_SCHEMA_VERSION,
	CAMPUS_DOCS_CHUNK_GOVERNANCE_DEFINITION,
} from "./chunk-governance-definitions.ts";
import {
	assertCampusDocsQuestionEvidence,
	chunkContainsEvidenceText,
	chunkMatchesEvidence,
	decodeCampusDocsQuestionNdjson,
} from "./chunk-governance-questions.ts";
import type {
	CampusDocsCachedEmbedding,
	CampusDocsChunkEmbeddingEvaluationArtifact,
	CampusDocsChunkEmbeddingEvaluationManifest,
	CampusDocsChunkEmbeddingEvaluationResult,
	CampusDocsChunkEmbeddingMetrics,
	CampusDocsQuestionRanking,
	CampusDocsRetrievalMetricSlice,
	CampusDocsRetrievalQuestion,
} from "./chunk-governance-types.ts";
import {
	canonicalJsonBytes,
	sha256,
} from "../../../apps/campus-web/src/docs-reader-build/source-catalog.ts";
import {
	EMBEDDING_SPACE,
	embedTexts,
	type EmbeddingClient,
} from "@campus-agent/embedding-runtime";
import { sha256Text } from "./indexing/content-digest.ts";
import type { ArtifactObjectStore, Sha256Ref, StoredChunk } from "./types.ts";

const EMBEDDING_CACHE_DIRECTORY = "embedding-cache";
const EMBEDDING_EVALUATION_DIRECTORY = "embedding-evaluations";
const CACHE_WRITE_CONCURRENCY = 64;

type RankingCutoff = (typeof CAMPUS_DOCS_CHUNK_GOVERNANCE_DEFINITION.embedding.rankingCutoffs)[number];
type RankingCutoffKey = `${RankingCutoff}`;

interface EmbeddingInputSet {
	documentTextByChunkId: Map<string, Sha256Ref>;
	queryTextByQuestionId: Map<string, Sha256Ref>;
	textBySha256: Map<Sha256Ref, string>;
}

interface ResolvedEmbeddingVectors {
	generatedInputCount: number;
	reusedInputCount: number;
	vectorsByTextSha256: Map<Sha256Ref, number[]>;
}

export async function runLocalCampusDocsChunkEmbeddingEvaluation(input: {
	artifactRoot: string;
	artifactStore: ArtifactObjectStore;
	chunkSet: Sha256Ref;
	embedding: EmbeddingClient;
	modelTargetSha256: string;
	onEmbeddingProgress?: (completedInputCount: number, totalInputCount: number) => void;
	onRankingProgress?: (completedQuestionCount: number, totalQuestionCount: number) => void;
	questionFile: string;
}): Promise<CampusDocsChunkEmbeddingEvaluationResult> {
	assertModelTargetSha256(input.modelTargetSha256);
	const [chunkSet, questionBytes] = await Promise.all([
		readGovernanceChunkSet(input.artifactStore, input.chunkSet),
		readFile(input.questionFile),
	]);
	const questions = decodeCampusDocsQuestionNdjson(new Uint8Array(questionBytes));
	assertCampusDocsQuestionEvidence(chunkSet.chunks, questions);
	const embeddingInputs = buildEmbeddingInputSet(chunkSet.chunks, questions);
	const resolved = await resolveEmbeddingVectors({
		artifactRoot: input.artifactRoot,
		embedding: input.embedding,
		modelTargetSha256: input.modelTargetSha256,
		...(input.onEmbeddingProgress ? { onProgress: input.onEmbeddingProgress } : {}),
		textBySha256: embeddingInputs.textBySha256,
	});
	const documentVectorsByChunkId = new Map<string, number[]>();
	for (const [chunkId, textSha256] of embeddingInputs.documentTextByChunkId) {
		const vector = resolved.vectorsByTextSha256.get(textSha256);
		if (!vector) throw new Error(`Embedding vector is missing for Campus docs chunk ${chunkId}`);
		documentVectorsByChunkId.set(chunkId, vector);
	}
	const queryVectorsByQuestionId = new Map<string, number[]>();
	for (const [questionId, textSha256] of embeddingInputs.queryTextByQuestionId) {
		const vector = resolved.vectorsByTextSha256.get(textSha256);
		if (!vector) throw new Error(`Embedding vector is missing for Campus docs question ${questionId}`);
		queryVectorsByQuestionId.set(questionId, vector);
	}
	const { metrics, rankings } = evaluateCampusDocsDenseRetrieval({
		chunks: chunkSet.chunks,
		documentVectorsByChunkId,
		...(input.onRankingProgress ? { onProgress: input.onRankingProgress } : {}),
		questions,
		queryVectorsByQuestionId,
	});
	const metricsBytes = canonicalJsonBytes(metrics);
	const rankingBytes = encodeGovernanceNdjson(rankings);
	const manifest: CampusDocsChunkEmbeddingEvaluationManifest = {
		chunkCount: chunkSet.chunks.length,
		chunkDefinition: chunkSet.manifest.chunkDefinition,
		chunkSet: input.chunkSet,
		definition: CAMPUS_DOCS_CHUNK_GOVERNANCE_DEFINITION.embedding,
		embeddingInputCount: embeddingInputs.textBySha256.size,
		metrics: reference("metrics.json", metricsBytes),
		modelTargetSha256: input.modelTargetSha256,
		questionCount: questions.length,
		questions: reference("questions.ndjson", new Uint8Array(questionBytes)),
		rankings: reference("rankings.ndjson", rankingBytes),
		schemaVersion: CAMPUS_DOCS_CHUNK_EMBEDDING_EVALUATION_SCHEMA_VERSION,
	};
	const manifestBytes = canonicalJsonBytes(manifest);
	const run = sha256(manifestBytes);
	const outputDirectory = join(
		input.artifactRoot,
		CAMPUS_DOCS_CHUNK_GOVERNANCE_ROOT,
		EMBEDDING_EVALUATION_DIRECTORY,
		"sha256",
		artifactHex(run),
	);
	await mkdir(outputDirectory, { recursive: true });
	await Promise.all([
		writeImmutableGovernanceFile(join(outputDirectory, "manifest.json"), manifestBytes),
		writeImmutableGovernanceFile(join(outputDirectory, "metrics.json"), metricsBytes),
		writeImmutableGovernanceFile(
			join(outputDirectory, "questions.ndjson"),
			new Uint8Array(questionBytes),
		),
		writeImmutableGovernanceFile(join(outputDirectory, "rankings.ndjson"), rankingBytes),
	]);
	return {
		generatedEmbeddingInputCount: resolved.generatedInputCount,
		metrics,
		outputDirectory,
		reusedEmbeddingInputCount: resolved.reusedInputCount,
		run,
	};
}

export async function readCampusDocsChunkEmbeddingEvaluation(
	artifactRoot: string,
	evaluationRun: Sha256Ref,
): Promise<CampusDocsChunkEmbeddingEvaluationArtifact> {
	const directory = join(
		artifactRoot,
		CAMPUS_DOCS_CHUNK_GOVERNANCE_ROOT,
		EMBEDDING_EVALUATION_DIRECTORY,
		"sha256",
		artifactHex(evaluationRun),
	);
	const manifestBytes = new Uint8Array(await readFile(join(directory, "manifest.json")));
	if (sha256(manifestBytes) !== evaluationRun) {
		throw new Error(`Campus docs embedding evaluation manifest digest does not match ${evaluationRun}`);
	}
	const manifestValue = parseJson(manifestBytes, "Campus docs embedding evaluation manifest");
	if (
		!isRecord(manifestValue) ||
		manifestValue.schemaVersion !== CAMPUS_DOCS_CHUNK_EMBEDDING_EVALUATION_SCHEMA_VERSION
	) {
		throw new Error("Campus docs embedding evaluation manifest schema is invalid");
	}
	const manifest = manifestValue as unknown as CampusDocsChunkEmbeddingEvaluationManifest;
	if (
		!positiveInteger(manifest.chunkCount) ||
		!positiveInteger(manifest.embeddingInputCount) ||
		!positiveInteger(manifest.questionCount) ||
		!isSha256Ref(manifest.chunkSet) ||
		!/^[0-9a-f]{64}$/u.test(manifest.modelTargetSha256)
	) {
		throw new Error("Campus docs embedding evaluation manifest definition is invalid");
	}
	assertArtifactReference(manifest.metrics, "Campus docs embedding evaluation metrics");
	assertArtifactReference(manifest.questions, "Campus docs embedding evaluation questions");
	assertArtifactReference(manifest.rankings, "Campus docs embedding evaluation rankings");
	const [metricsBytes, questionBytes, rankingBytes] = await Promise.all([
		readVerifiedGovernanceFile(directory, manifest.metrics, "Campus docs embedding evaluation metrics"),
		readVerifiedGovernanceFile(directory, manifest.questions, "Campus docs embedding evaluation questions"),
		readVerifiedGovernanceFile(directory, manifest.rankings, "Campus docs embedding evaluation rankings"),
	]);
	const metricsValue = parseJson(metricsBytes, "Campus docs embedding evaluation metrics");
	if (
		!isRecord(metricsValue) ||
		metricsValue.schemaVersion !== CAMPUS_DOCS_CHUNK_EMBEDDING_METRICS_SCHEMA_VERSION
	) {
		throw new Error("Campus docs embedding evaluation metrics schema is invalid");
	}
	const metrics = metricsValue as unknown as CampusDocsChunkEmbeddingMetrics;
	const questions = decodeCampusDocsQuestionNdjson(questionBytes);
	const rankings = decodeRankingNdjson(rankingBytes);
	if (questions.length !== manifest.questionCount || rankings.length !== manifest.questionCount) {
		throw new Error("Campus docs embedding evaluation question count does not match the manifest");
	}
	if (rankings.some((ranking, index) => ranking.questionId !== questions[index]?.questionId)) {
		throw new Error("Campus docs embedding evaluation ranking order does not match questions");
	}
	return { evaluationRun, manifest, metrics, questions, rankings };
}

export function formatCampusDocsQuery(question: string): string {
	const value = question.trim();
	if (!value) throw new Error("Campus docs retrieval question is required");
	return `Instruct: ${CAMPUS_DOCS_CHUNK_GOVERNANCE_DEFINITION.embedding.queryInstruction}\nQuery:${value}`;
}

export function evaluateCampusDocsDenseRetrieval(input: {
	chunks: readonly StoredChunk[];
	documentVectorsByChunkId: ReadonlyMap<string, readonly number[]>;
	onProgress?: (completedQuestionCount: number, totalQuestionCount: number) => void;
	questions: readonly CampusDocsRetrievalQuestion[];
	queryVectorsByQuestionId: ReadonlyMap<string, readonly number[]>;
}): { metrics: CampusDocsChunkEmbeddingMetrics; rankings: CampusDocsQuestionRanking[] } {
	if (input.chunks.length === 0) throw new Error("Campus docs dense retrieval evaluation requires chunks");
	if (input.questions.length === 0) throw new Error("Campus docs dense retrieval evaluation requires questions");
	const denseChunks = input.chunks.map((chunk) => {
		const vector = input.documentVectorsByChunkId.get(chunk.chunkId);
		if (!vector) throw new Error(`Dense vector is missing for Campus docs chunk ${chunk.chunkId}`);
		return { chunk, norm: vectorNorm(vector), vector };
	});
	const rankings: CampusDocsQuestionRanking[] = [];
	for (const [questionIndex, question] of input.questions.entries()) {
		const queryVector = input.queryVectorsByQuestionId.get(question.questionId);
		if (!queryVector) {
			throw new Error(`Dense vector is missing for Campus docs question ${question.questionId}`);
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
				(chunk) =>
					chunk.documentId === question.documentId && chunkMatchesEvidence(chunk, evidence),
			),
		);
		const answerEvidenceRanks = question.evidence.map(
			(evidence) =>
				bestRankedChunk(
					scored,
					(chunk) =>
						chunk.documentId === question.documentId &&
						chunkContainsEvidenceText(chunk, evidence),
				).rank,
		);
		const evidenceChunkRanks = Object.fromEntries(
			targetEvidence.map(({ chunk, rank }) => [chunk.chunkId, rank]),
		);
		const evidenceChunkIds = [...new Set(targetEvidence.map(({ chunk }) => chunk.chunkId))];
		const evidenceRanks = targetEvidence.map(({ rank }) => rank);
		const firstDocumentRank = scored.findIndex(
			(item) => item.chunk.documentId === question.documentId,
		) + 1;
		if (firstDocumentRank === 0) {
			throw new Error(`Campus docs document ${question.documentId} is missing from dense ranking`);
		}
		rankings.push({
			allEvidenceRank: Math.max(...evidenceRanks),
			answer: question.answer,
			answerEvidenceRank: Math.max(...answerEvidenceRanks),
			documentId: question.documentId,
			evidenceChunkIds,
			evidenceChunkRanks,
			firstDocumentRank,
			firstEvidenceRank: Math.min(...evidenceRanks),
			question: question.question,
			questionId: question.questionId,
			singleChunkAnswerRank: singleChunkAnswerRank(scored, question),
			stratum: question.stratum,
			topChunks: scored
				.slice(0, CAMPUS_DOCS_CHUNK_GOVERNANCE_DEFINITION.embedding.rankingDepth)
				.map(({ chunk, score }, rankIndex) => ({
					chunkId: chunk.chunkId,
					content: chunk.content,
					documentId: chunk.documentId,
					documentTitle: chunk.documentTitle,
					rank: rankIndex + 1,
					rootUnitIds: chunk.rootUnitIds,
					score: round(score, 8),
					sectionId: chunk.sectionId,
					sectionTitle: chunk.sectionTitle,
				})),
		});
		input.onProgress?.(questionIndex + 1, input.questions.length);
	}
	const overall = summarizeRankings(rankings);
	const strata = [...new Set(rankings.map((ranking) => ranking.stratum))].sort();
	const byStratum = Object.fromEntries(
		strata.map((stratum) => [
			stratum,
			summarizeRankings(rankings.filter((ranking) => ranking.stratum === stratum)),
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
			definition: CAMPUS_DOCS_CHUNK_GOVERNANCE_DEFINITION.embedding,
			multiChunkEvidenceQuestionCount: rankings.length - singleChunkEvidenceQuestionCount,
			schemaVersion: CAMPUS_DOCS_CHUNK_EMBEDDING_METRICS_SCHEMA_VERSION,
			singleChunkEvidenceQuestionCount,
		},
		rankings,
	};
}

function decodeRankingNdjson(bytes: Uint8Array): CampusDocsQuestionRanking[] {
	return decodeGovernanceNdjson(bytes).map((value, index) => {
		if (!isRecord(value)) throw new Error(`Campus docs ranking record ${index} is invalid`);
		for (const field of ["answer", "documentId", "question", "questionId", "stratum"] as const) {
			if (!nonEmptyString(value[field])) {
				throw new Error(`Campus docs ranking record ${index} has invalid ${field}`);
			}
		}
		if (!Array.isArray(value.topChunks)) {
			throw new Error(`Campus docs ranking record ${index} has invalid topChunks`);
		}
		return value as unknown as CampusDocsQuestionRanking;
	});
}

function buildEmbeddingInputSet(
	chunks: readonly StoredChunk[],
	questions: readonly CampusDocsRetrievalQuestion[],
): EmbeddingInputSet {
	const textBySha256 = new Map<Sha256Ref, string>();
	const addText = (text: string): Sha256Ref => {
		const digest = sha256Text(text);
		const existing = textBySha256.get(digest);
		if (existing !== undefined && existing !== text) {
			throw new Error(`Campus docs embedding text SHA-256 collision: ${digest}`);
		}
		textBySha256.set(digest, text);
		return digest;
	};
	const documentTextByChunkId = new Map<string, Sha256Ref>();
	for (const chunk of chunks) {
		documentTextByChunkId.set(chunk.chunkId, addText(chunk.retrievalText));
	}
	const queryTextByQuestionId = new Map<string, Sha256Ref>();
	for (const question of questions) {
		queryTextByQuestionId.set(question.questionId, addText(formatCampusDocsQuery(question.question)));
	}
	return { documentTextByChunkId, queryTextByQuestionId, textBySha256 };
}

async function resolveEmbeddingVectors(input: {
	artifactRoot: string;
	embedding: EmbeddingClient;
	modelTargetSha256: string;
	onProgress?: (completedInputCount: number, totalInputCount: number) => void;
	textBySha256: ReadonlyMap<Sha256Ref, string>;
}): Promise<ResolvedEmbeddingVectors> {
	const cacheDirectory = join(
		input.artifactRoot,
		CAMPUS_DOCS_CHUNK_GOVERNANCE_ROOT,
		EMBEDDING_CACHE_DIRECTORY,
		input.modelTargetSha256,
		"sha256",
	);
	await mkdir(cacheDirectory, { recursive: true });
	const cachedNames = new Set(await readdir(cacheDirectory));
	const vectorsByTextSha256 = new Map<Sha256Ref, number[]>();
	const missing: Array<[Sha256Ref, string]> = [];
	const sortedInputs = [...input.textBySha256].sort(([left], [right]) => left.localeCompare(right));
	for (const [textSha256, text] of sortedInputs) {
		const fileName = `${artifactHex(textSha256)}.json`;
		if (!cachedNames.has(fileName)) {
			missing.push([textSha256, text]);
			continue;
		}
		const bytes = new Uint8Array(await readFile(join(cacheDirectory, fileName)));
		const cached = parseCachedEmbedding(bytes, textSha256, input.modelTargetSha256);
		vectorsByTextSha256.set(textSha256, cached.dense);
	}
	const generatedVectors = await embedTexts(
		input.embedding,
		missing.map(([, text]) => text),
		input.onProgress,
	);
	const writes: Array<{ bytes: Uint8Array; path: string }> = [];
	for (const [index, [textSha256]] of missing.entries()) {
		const dense = generatedVectors[index];
		if (!dense) throw new Error(`Embedding result is missing for ${textSha256}`);
		const cached: CampusDocsCachedEmbedding = {
			dense,
			embeddingSpace: EMBEDDING_SPACE,
			modelTargetSha256: input.modelTargetSha256,
			schemaVersion: CAMPUS_DOCS_CHUNK_EMBEDDING_CACHE_SCHEMA_VERSION,
			textSha256,
		};
		vectorsByTextSha256.set(textSha256, dense);
		writes.push({
			bytes: canonicalJsonBytes(cached),
			path: join(cacheDirectory, `${artifactHex(textSha256)}.json`),
		});
	}
	for (let offset = 0; offset < writes.length; offset += CACHE_WRITE_CONCURRENCY) {
		await Promise.all(
			writes
				.slice(offset, offset + CACHE_WRITE_CONCURRENCY)
				.map((write) => writeImmutableGovernanceFile(write.path, write.bytes)),
		);
	}
	if (vectorsByTextSha256.size !== input.textBySha256.size) {
		throw new Error("Campus docs embedding cache does not cover every evaluation input");
	}
	return {
		generatedInputCount: missing.length,
		reusedInputCount: input.textBySha256.size - missing.length,
		vectorsByTextSha256,
	};
}

function parseCachedEmbedding(
	bytes: Uint8Array,
	expectedTextSha256: Sha256Ref,
	expectedModelTargetSha256: string,
): CampusDocsCachedEmbedding {
	const value = parseJson(bytes, "Cached Campus docs embedding");
	if (
		!isRecord(value) ||
		value.schemaVersion !== CAMPUS_DOCS_CHUNK_EMBEDDING_CACHE_SCHEMA_VERSION
	) {
		throw new Error("Cached Campus docs embedding schema is invalid");
	}
	const cached = value as unknown as CampusDocsCachedEmbedding;
	if (
		cached.textSha256 !== expectedTextSha256 ||
		cached.modelTargetSha256 !== expectedModelTargetSha256 ||
		!isDeepStrictEqual(cached.embeddingSpace, EMBEDDING_SPACE) ||
		!validDenseVector(cached.dense)
	) {
		throw new Error(`Cached Campus docs embedding is invalid: ${expectedTextSha256}`);
	}
	if (!Buffer.from(canonicalJsonBytes(cached)).equals(Buffer.from(bytes))) {
		throw new Error(`Cached Campus docs embedding is not canonical: ${expectedTextSha256}`);
	}
	return cached;
}

function summarizeRankings(
	rankings: readonly CampusDocsQuestionRanking[],
): CampusDocsRetrievalMetricSlice {
	if (rankings.length === 0) throw new Error("Campus docs retrieval metric slice requires rankings");
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
		meanDocumentReciprocalRank: round(
			rankings.reduce((sum, ranking) => sum + 1 / ranking.firstDocumentRank, 0) /
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
		documentRecallAt: cutoffRecord((cutoff) =>
			fraction(rankings, (ranking) => ranking.firstDocumentRank <= cutoff),
		),
		questionCount: rankings.length,
		singleChunkAnswerQuestionCount: singleChunkAnswerRankings.length,
		singleChunkAnswerRecallAt: cutoffRecord((cutoff) =>
			singleChunkAnswerRankings.length === 0
				? 0
				: fraction(
						singleChunkAnswerRankings,
						(ranking) => ranking.singleChunkAnswerRank! <= cutoff,
					),
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
		CAMPUS_DOCS_CHUNK_GOVERNANCE_DEFINITION.embedding.rankingCutoffs.map((cutoff) => [
			String(cutoff),
			valueFor(cutoff),
		]),
	) as Record<RankingCutoffKey, number>;
}

function fraction<T>(items: readonly T[], predicate: (item: T) => boolean): number {
	return round(items.filter(predicate).length / items.length, 6);
}

function bestRankedChunk(
	scored: readonly { chunk: StoredChunk; score: number }[],
	matches: (chunk: StoredChunk) => boolean,
): { chunk: StoredChunk; rank: number } {
	const index = scored.findIndex((item) => matches(item.chunk));
	const item = scored[index];
	if (index < 0 || !item) throw new Error("Campus docs evidence is missing from dense ranking");
	return { chunk: item.chunk, rank: index + 1 };
}

function singleChunkAnswerRank(
	scored: readonly { chunk: StoredChunk; score: number }[],
	question: CampusDocsRetrievalQuestion,
): number | null {
	const index = scored.findIndex(
		(item) =>
			item.chunk.documentId === question.documentId &&
			question.evidence.every((evidence) => chunkMatchesEvidence(item.chunk, evidence)),
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
		throw new Error(`Dense vector dimensions differ: ${left.length} and ${right.length}`);
	}
	let dot = 0;
	for (let index = 0; index < left.length; index += 1) {
		dot += left[index]! * right[index]!;
	}
	return dot / (leftNorm * rightNorm);
}

function vectorNorm(vector: readonly number[]): number {
	if (vector.length === 0 || vector.some((value) => !Number.isFinite(value))) {
		throw new Error("Dense vector is invalid");
	}
	const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
	if (!Number.isFinite(norm) || norm === 0) throw new Error("Dense vector norm is invalid");
	return norm;
}

function validDenseVector(value: unknown): value is number[] {
	return (
		Array.isArray(value) &&
		value.length === EMBEDDING_SPACE.dimensions &&
		value.every((item) => typeof item === "number" && Number.isFinite(item))
	);
}

function assertArtifactReference(
	value: unknown,
	label: string,
): asserts value is { byteSize: number; file: string; sha256: Sha256Ref } {
	if (
		!isRecord(value) ||
		!positiveInteger(value.byteSize) ||
		!nonEmptyString(value.file) ||
		!isSha256Ref(value.sha256)
	) {
		throw new Error(`${label} reference is invalid`);
	}
}

function parseJson(bytes: Uint8Array, label: string): unknown {
	try {
		return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
	} catch (error) {
		throw new Error(`${label} is not valid UTF-8 JSON`, { cause: error });
	}
}

function assertModelTargetSha256(value: string): void {
	if (!/^[0-9a-f]{64}$/u.test(value)) {
		throw new Error("Embedding model target must be 64 lowercase hex characters");
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isSha256Ref(value: unknown): value is Sha256Ref {
	return typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
}

function nonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim() !== "";
}

function positiveInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function round(value: number, digits: number): number {
	return Number(value.toFixed(digits));
}
