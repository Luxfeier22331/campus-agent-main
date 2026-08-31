import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { writeImmutable } from "./artifacts.ts";
import type { NoticeChunkDefinition } from "./definitions.ts";
import {
	decodeNoticeQuestionNdjson,
	readNoticeEmbeddingEvaluation,
	type NoticeEmbeddingEvaluationArtifact,
	type NoticeQuestionRanking,
	type NoticeRetrievalQuestion,
	type RetrievalMetricSlice,
} from "./embedding-evaluation.ts";
import { canonicalJsonBytes, sha256 } from "./encoding.ts";
import {
	artifactHex,
	readNoticeChunkRun,
	type NoticeChunkRunData,
} from "./run-reader.ts";
import type {
	DistributionSummary,
	NoticeChunk,
	NoticeChunkValidationReport,
	Sha256Ref,
} from "./types.ts";

export const NOTICE_CHUNK_COMPARISON_SCHEMA_VERSION =
	"notice_chunk_comparison.v1" as const;

const CHUNK_METRIC_NAMES = [
	"clauseSplitCount",
	"fieldValueSplitCount",
	"footerOnlyChunkCount",
	"hardCutCount",
	"headingContentDuplicateCount",
	"formalHeadingPathViolationCount",
	"listContinuationSplitCount",
	"noticesWithoutDetectedHeadings",
	"primaryBoundaryCrossingCount",
	"primaryHeadingCount",
	"secondaryBoundaryCrossingCount",
	"secondaryHeadingCount",
	"sentenceSplitCount",
	"standaloneUrlCount",
	"tableHeaderContextMissingCount",
	"tableRowSplitCount",
	"tinyChunkCount",
	"orphanLabelCount",
	"urlOwnerSplitCount",
] as const;

const MEAN_METRIC_NAMES = [
	"meanAnswerReciprocalRank",
	"meanNoticeReciprocalRank",
	"meanSingleChunkAnswerReciprocalRank",
] as const;

const RECALL_METRIC_NAMES = [
	"answerEvidenceRecallAt",
	"noticeRecallAt",
	"singleChunkAnswerRecallAt",
] as const;

type ChunkMetricName = (typeof CHUNK_METRIC_NAMES)[number];
type MeanMetricName = (typeof MEAN_METRIC_NAMES)[number];
type RecallMetricName = (typeof RECALL_METRIC_NAMES)[number];
type RankingCutoffKey = "1" | "3" | "5" | "10";

export interface NumericDelta {
	baseline: number;
	candidate: number;
	delta: number;
}

export interface NoticeChunkRunSummary {
	chunkChars: DistributionSummary;
	chunkCount: number;
	chunkRun: Sha256Ref;
	definition: NoticeChunkDefinition;
	metrics: Record<ChunkMetricName, number>;
	noticeCount: number;
}

export interface NoticeChunkComparisonDelta {
	chunkChars: {
		baseline: DistributionSummary;
		candidate: DistributionSummary;
		delta: DistributionSummary;
	};
	chunkCount: NumericDelta;
	metrics: Record<ChunkMetricName, NumericDelta>;
	noticeCount: NumericDelta;
}

export interface NoticeEvidencePlacement {
	allEvidenceInSingleChunk: boolean;
	evidenceChunkIndexes: number[];
	evidenceChunkIndexesByEvidence: number[][];
	missingEvidenceCount: number;
}

export interface NoticeQuestionRankSnapshot {
	answerEvidenceRank: number;
	firstNoticeRank: number;
	singleChunkAnswerRank: number | null;
}

export interface NoticeQuestionComparison {
	answer: string;
	baseline: {
		placement: NoticeEvidencePlacement;
		ranking: NoticeQuestionRankSnapshot;
	};
	candidate: {
		placement: NoticeEvidencePlacement;
		ranking: NoticeQuestionRankSnapshot;
	};
	evidence: string[];
	noticeId: string;
	placementChanged: boolean;
	question: string;
	questionId: string;
	rankChange: {
		answerEvidenceRank: number;
		firstNoticeRank: number;
		singleChunkAnswerRank: number | null;
	};
	stratum: string;
}

export interface RankChangeSummary {
	improved: number;
	regressed: number;
	unchanged: number;
}

export interface NoticeRetrievalMetricComparison {
	mean: Record<MeanMetricName, NumericDelta>;
	questionCount: NumericDelta;
	recallAt: Record<RecallMetricName, Record<RankingCutoffKey, NumericDelta>>;
	singleChunkAnswerQuestionCount: NumericDelta;
}

export interface NoticeChunkComparisonReport {
	baseline: NoticeChunkRunSummary;
	candidate: NoticeChunkRunSummary;
	chunkDelta: NoticeChunkComparisonDelta;
	embedding: {
		baselineEvaluation: Sha256Ref;
		byStratum: Record<string, NoticeRetrievalMetricComparison>;
		candidateEvaluation: Sha256Ref;
		modelTargetSha256: string;
		overall: NoticeRetrievalMetricComparison;
	};
	questionFileSha256: Sha256Ref;
	questionSummary: {
		answerEvidenceRank: RankChangeSummary;
		firstNoticeRank: RankChangeSummary;
		missingEvidenceQuestionCount: NumericDelta;
		placementChangedCount: number;
		questionCount: number;
		singleChunkEvidenceQuestionCount: NumericDelta;
	};
	questions: NoticeQuestionComparison[];
	schemaVersion: typeof NOTICE_CHUNK_COMPARISON_SCHEMA_VERSION;
}

export interface LocalNoticeChunkComparisonResult {
	outputDirectory: string;
	report: NoticeChunkComparisonReport;
	run: Sha256Ref;
}

export async function runLocalNoticeChunkComparison(input: {
	artifactRoot: string;
	baselineChunkRun: Sha256Ref;
	baselineEvaluation: Sha256Ref;
	candidateChunkRun: Sha256Ref;
	candidateEvaluation: Sha256Ref;
	questionFile: string;
}): Promise<LocalNoticeChunkComparisonResult> {
	const [baseline, candidate, baselineEvaluation, candidateEvaluation, questionBytes] =
		await Promise.all([
			readNoticeChunkRun(input.artifactRoot, input.baselineChunkRun),
			readNoticeChunkRun(input.artifactRoot, input.candidateChunkRun),
			readNoticeEmbeddingEvaluation(input.artifactRoot, input.baselineEvaluation),
			readNoticeEmbeddingEvaluation(input.artifactRoot, input.candidateEvaluation),
			readFile(input.questionFile),
		]);
	const questions = decodeNoticeQuestionNdjson(questionBytes);
	const questionFileSha256 = sha256(questionBytes);
	const report = buildNoticeChunkComparison({
		baseline,
		baselineChunkRun: input.baselineChunkRun,
		baselineEvaluation,
		candidate,
		candidateChunkRun: input.candidateChunkRun,
		candidateEvaluation,
		questionFileSha256,
		questions,
	});
	const reportBytes = canonicalJsonBytes(report);
	const run = sha256(reportBytes);
	const outputDirectory = join(
		input.artifactRoot,
		"notices",
		"chunking",
		"comparisons",
		"sha256",
		artifactHex(run),
	);
	await mkdir(outputDirectory, { recursive: true });
	await writeImmutable(join(outputDirectory, "comparison.json"), reportBytes);
	return { outputDirectory, report, run };
}

export function buildNoticeChunkComparison(input: {
	baseline: NoticeChunkRunData;
	baselineChunkRun: Sha256Ref;
	baselineEvaluation: NoticeEmbeddingEvaluationArtifact;
	candidate: NoticeChunkRunData;
	candidateChunkRun: Sha256Ref;
	candidateEvaluation: NoticeEmbeddingEvaluationArtifact;
	questionFileSha256: Sha256Ref;
	questions: readonly NoticeRetrievalQuestion[];
}): NoticeChunkComparisonReport {
	assertComparableInputs(input);
	const baseline = summarizeChunkRun(input.baselineChunkRun, input.baseline);
	const candidate = summarizeChunkRun(input.candidateChunkRun, input.candidate);
	const baselineRankings = new Map(
		input.baselineEvaluation.rankings.map((ranking) => [ranking.questionId, ranking]),
	);
	const candidateRankings = new Map(
		input.candidateEvaluation.rankings.map((ranking) => [ranking.questionId, ranking]),
	);
	const questions = input.questions.map((question) => {
		const baselineRanking = baselineRankings.get(question.questionId);
		const candidateRanking = candidateRankings.get(question.questionId);
		if (!baselineRanking || !candidateRanking) {
			throw new Error(`notice comparison ranking is missing for ${question.questionId}`);
		}
		return compareQuestion(
			input.baseline.chunks,
			baselineRanking,
			input.candidate.chunks,
			candidateRanking,
			question,
		);
	});
	return {
		baseline,
		candidate,
		chunkDelta: compareChunkRuns(baseline, candidate),
		embedding: {
			baselineEvaluation: input.baselineEvaluation.evaluationRun,
			byStratum: compareMetricStrata(
				input.baselineEvaluation.metrics.byStratum,
				input.candidateEvaluation.metrics.byStratum,
			),
			candidateEvaluation: input.candidateEvaluation.evaluationRun,
			modelTargetSha256: input.baselineEvaluation.manifest.modelTargetSha256,
			overall: compareMetricSlice(
				input.baselineEvaluation.metrics,
				input.candidateEvaluation.metrics,
			),
		},
		questionFileSha256: input.questionFileSha256,
		questionSummary: summarizeQuestionComparisons(questions),
		questions,
		schemaVersion: NOTICE_CHUNK_COMPARISON_SCHEMA_VERSION,
	};
}

export function placeNoticeQuestionEvidence(
	chunks: readonly NoticeChunk[],
	question: NoticeRetrievalQuestion,
): NoticeEvidencePlacement {
	const noticeChunks = chunks
		.filter((chunk) => chunk.noticeId === question.noticeId)
		.sort((left, right) => left.chunkIndex - right.chunkIndex);
	const evidenceChunkIndexesByEvidence = question.evidence.map((evidence) =>
		noticeChunks
			.filter((chunk) => chunk.content.includes(evidence.text))
			.map((chunk) => chunk.chunkIndex),
	);
	const evidenceChunkIndexes = [
		...new Set(evidenceChunkIndexesByEvidence.flat()),
	].sort((left, right) => left - right);
	const commonChunkIndexes = evidenceChunkIndexes.filter((chunkIndex) =>
		evidenceChunkIndexesByEvidence.every((indexes) => indexes.includes(chunkIndex)),
	);
	return {
		allEvidenceInSingleChunk: commonChunkIndexes.length > 0,
		evidenceChunkIndexes,
		evidenceChunkIndexesByEvidence,
		missingEvidenceCount: evidenceChunkIndexesByEvidence.filter((indexes) => indexes.length === 0)
			.length,
	};
}

function assertComparableInputs(input: {
	baseline: NoticeChunkRunData;
	baselineChunkRun: Sha256Ref;
	baselineEvaluation: NoticeEmbeddingEvaluationArtifact;
	candidate: NoticeChunkRunData;
	candidateChunkRun: Sha256Ref;
	candidateEvaluation: NoticeEmbeddingEvaluationArtifact;
	questionFileSha256: Sha256Ref;
	questions: readonly NoticeRetrievalQuestion[];
}): void {
	if (input.baselineEvaluation.manifest.chunkRun !== input.baselineChunkRun) {
		throw new Error("baseline embedding evaluation does not match the baseline chunk run");
	}
	if (input.candidateEvaluation.manifest.chunkRun !== input.candidateChunkRun) {
		throw new Error("candidate embedding evaluation does not match the candidate chunk run");
	}
	if (
		input.baselineEvaluation.manifest.modelTargetSha256 !==
		input.candidateEvaluation.manifest.modelTargetSha256
	) {
		throw new Error("notice embedding evaluations use different model targets");
	}
	if (
		input.baselineEvaluation.manifest.questions.sha256 !== input.questionFileSha256 ||
		input.candidateEvaluation.manifest.questions.sha256 !== input.questionFileSha256
	) {
		throw new Error("notice embedding evaluations do not use the supplied question file");
	}
	if (
		!isDeepStrictEqual(
			input.baselineEvaluation.manifest.definition,
			input.candidateEvaluation.manifest.definition,
		)
	) {
		throw new Error("notice embedding evaluations use different definitions");
	}
	if (
		!isDeepStrictEqual(
			input.baselineEvaluation.manifest.chunkDefinition,
			input.baseline.manifest.definition,
		) ||
		!isDeepStrictEqual(
			input.candidateEvaluation.manifest.chunkDefinition,
			input.candidate.manifest.definition,
		)
	) {
		throw new Error("notice embedding evaluation chunk definitions do not match their runs");
	}
	if (
		input.baselineEvaluation.manifest.chunkCount !== input.baseline.chunks.length ||
		input.candidateEvaluation.manifest.chunkCount !== input.candidate.chunks.length
	) {
		throw new Error("notice embedding evaluation chunk counts do not match their runs");
	}
	const baselineNoticeIds = [...input.baseline.chunksByNoticeId.keys()].sort();
	const candidateNoticeIds = [...input.candidate.chunksByNoticeId.keys()].sort();
	if (!isDeepStrictEqual(baselineNoticeIds, candidateNoticeIds)) {
		throw new Error("notice chunk runs contain different notice IDs");
	}
	if (
		input.questions.length !== input.baselineEvaluation.questions.length ||
		input.questions.length !== input.candidateEvaluation.questions.length
	) {
		throw new Error("notice comparison question counts differ");
	}
}

function summarizeChunkRun(
	chunkRun: Sha256Ref,
	run: NoticeChunkRunData,
): NoticeChunkRunSummary {
	return {
		chunkChars: run.validation.chunkChars,
		chunkCount: run.validation.chunkCount,
		chunkRun,
		definition: run.manifest.definition,
		metrics: chunkMetrics(run.validation),
		noticeCount: run.validation.noticeCount,
	};
}

function chunkMetrics(
	validation: NoticeChunkValidationReport,
): Record<ChunkMetricName, number> {
	return Object.fromEntries(
		CHUNK_METRIC_NAMES.map((name) => [name, validation[name]]),
	) as Record<ChunkMetricName, number>;
}

function compareChunkRuns(
	baseline: NoticeChunkRunSummary,
	candidate: NoticeChunkRunSummary,
): NoticeChunkComparisonDelta {
	return {
		chunkChars: distributionDelta(baseline.chunkChars, candidate.chunkChars),
		chunkCount: numericDelta(baseline.chunkCount, candidate.chunkCount),
		metrics: Object.fromEntries(
			CHUNK_METRIC_NAMES.map((name) => [
				name,
				numericDelta(baseline.metrics[name], candidate.metrics[name]),
			]),
		) as Record<ChunkMetricName, NumericDelta>,
		noticeCount: numericDelta(baseline.noticeCount, candidate.noticeCount),
	};
}

function compareQuestion(
	baselineChunks: readonly NoticeChunk[],
	baselineRanking: NoticeQuestionRanking,
	candidateChunks: readonly NoticeChunk[],
	candidateRanking: NoticeQuestionRanking,
	question: NoticeRetrievalQuestion,
): NoticeQuestionComparison {
	const baselinePlacement = placeNoticeQuestionEvidence(baselineChunks, question);
	const candidatePlacement = placeNoticeQuestionEvidence(candidateChunks, question);
	return {
		answer: question.answer,
		baseline: {
			placement: baselinePlacement,
			ranking: rankSnapshot(baselineRanking),
		},
		candidate: {
			placement: candidatePlacement,
			ranking: rankSnapshot(candidateRanking),
		},
		evidence: question.evidence.map((evidence) => evidence.text),
		noticeId: question.noticeId,
		placementChanged: !isDeepStrictEqual(baselinePlacement, candidatePlacement),
		question: question.question,
		questionId: question.questionId,
		rankChange: {
			answerEvidenceRank:
				candidateRanking.answerEvidenceRank - baselineRanking.answerEvidenceRank,
			firstNoticeRank: candidateRanking.firstNoticeRank - baselineRanking.firstNoticeRank,
			singleChunkAnswerRank: nullableRankChange(
				baselineRanking.singleChunkAnswerRank,
				candidateRanking.singleChunkAnswerRank,
			),
		},
		stratum: question.stratum,
	};
}

function rankSnapshot(ranking: NoticeQuestionRanking): NoticeQuestionRankSnapshot {
	return {
		answerEvidenceRank: ranking.answerEvidenceRank,
		firstNoticeRank: ranking.firstNoticeRank,
		singleChunkAnswerRank: ranking.singleChunkAnswerRank,
	};
}

function nullableRankChange(baseline: number | null, candidate: number | null): number | null {
	return baseline === null || candidate === null ? null : candidate - baseline;
}

function summarizeQuestionComparisons(
	questions: readonly NoticeQuestionComparison[],
): NoticeChunkComparisonReport["questionSummary"] {
	return {
		answerEvidenceRank: summarizeRankChanges(
			questions.map((question) => question.rankChange.answerEvidenceRank),
		),
		firstNoticeRank: summarizeRankChanges(
			questions.map((question) => question.rankChange.firstNoticeRank),
		),
		missingEvidenceQuestionCount: numericDelta(
			questions.filter((question) => question.baseline.placement.missingEvidenceCount > 0).length,
			questions.filter((question) => question.candidate.placement.missingEvidenceCount > 0).length,
		),
		placementChangedCount: questions.filter((question) => question.placementChanged).length,
		questionCount: questions.length,
		singleChunkEvidenceQuestionCount: numericDelta(
			questions.filter((question) => question.baseline.placement.allEvidenceInSingleChunk)
				.length,
			questions.filter((question) => question.candidate.placement.allEvidenceInSingleChunk)
				.length,
		),
	};
}

function summarizeRankChanges(changes: readonly number[]): RankChangeSummary {
	return {
		improved: changes.filter((change) => change < 0).length,
		regressed: changes.filter((change) => change > 0).length,
		unchanged: changes.filter((change) => change === 0).length,
	};
}

function compareMetricStrata(
	baseline: Readonly<Record<string, RetrievalMetricSlice>>,
	candidate: Readonly<Record<string, RetrievalMetricSlice>>,
): Record<string, NoticeRetrievalMetricComparison> {
	const strata = [...new Set([...Object.keys(baseline), ...Object.keys(candidate)])].sort();
	return Object.fromEntries(
		strata.map((stratum) => {
			const baselineSlice = baseline[stratum];
			const candidateSlice = candidate[stratum];
			if (!baselineSlice || !candidateSlice) {
				throw new Error("notice embedding evaluations contain different strata");
			}
			return [stratum, compareMetricSlice(baselineSlice, candidateSlice)];
		}),
	);
}

function compareMetricSlice(
	baseline: RetrievalMetricSlice,
	candidate: RetrievalMetricSlice,
): NoticeRetrievalMetricComparison {
	return {
		mean: Object.fromEntries(
			MEAN_METRIC_NAMES.map((name) => [name, numericDelta(baseline[name], candidate[name])]),
		) as Record<MeanMetricName, NumericDelta>,
		questionCount: numericDelta(baseline.questionCount, candidate.questionCount),
		recallAt: Object.fromEntries(
			RECALL_METRIC_NAMES.map((name) => [
				name,
				compareRecallAt(baseline[name], candidate[name]),
			]),
		) as Record<RecallMetricName, Record<RankingCutoffKey, NumericDelta>>,
		singleChunkAnswerQuestionCount: numericDelta(
			baseline.singleChunkAnswerQuestionCount,
			candidate.singleChunkAnswerQuestionCount,
		),
	};
}

function compareRecallAt(
	baseline: Record<RankingCutoffKey, number>,
	candidate: Record<RankingCutoffKey, number>,
): Record<RankingCutoffKey, NumericDelta> {
	return {
		"1": numericDelta(baseline["1"], candidate["1"]),
		"3": numericDelta(baseline["3"], candidate["3"]),
		"5": numericDelta(baseline["5"], candidate["5"]),
		"10": numericDelta(baseline["10"], candidate["10"]),
	};
}

function distributionDelta(
	baseline: DistributionSummary,
	candidate: DistributionSummary,
): NoticeChunkComparisonDelta["chunkChars"] {
	return {
		baseline,
		candidate,
		delta: {
			max: candidate.max - baseline.max,
			p50: candidate.p50 - baseline.p50,
			p75: candidate.p75 - baseline.p75,
			p90: candidate.p90 - baseline.p90,
			p95: candidate.p95 - baseline.p95,
		},
	};
}

function numericDelta(baseline: number, candidate: number): NumericDelta {
	return { baseline, candidate, delta: round(candidate - baseline) };
}

function round(value: number): number {
	return Number(value.toFixed(6));
}
