import {
	CHUNK_METRIC_NAMES,
	MEAN_METRIC_NAMES,
	RECALL_METRIC_NAMES,
	type ChunkMetricName,
	type MeanMetricName,
	type NoticeChunkComparisonDelta,
	type NoticeChunkComparisonReport,
	type NoticeChunkRunSummary,
	type NoticeQuestionComparison,
	type NoticeRetrievalMetricComparison,
	type NumericDelta,
	type MetricDelta,
	type RankingCutoffKey,
	type RankChangeSummary,
	type RecallMetricName,
} from "./model.ts";
import type { DistributionSummary, NoticeChunkValidationReport, Sha256Ref } from "../types.ts";
import type { RetrievalMetricSlice } from "../embedding-evaluation/model.ts";
import type { NoticeChunkDefinition } from "../definitions.ts";

export function summarizeChunkRun(
	chunkRun: Sha256Ref,
	run: {
		manifest: { definition: NoticeChunkDefinition };
		validation: NoticeChunkValidationReport;
	},
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

export function compareChunkRuns(
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

export function summarizeQuestionComparisons(
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

export function compareMetricStrata(
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

export function compareMetricSlice(
	baseline: RetrievalMetricSlice,
	candidate: RetrievalMetricSlice,
): NoticeRetrievalMetricComparison {
	return {
		mean: Object.fromEntries(
			MEAN_METRIC_NAMES.map((name) => [name, metricDelta(baseline[name], candidate[name])]),
		) as Record<MeanMetricName, MetricDelta>,
		questionCount: numericDelta(baseline.questionCount, candidate.questionCount),
		recallAt: Object.fromEntries(
			RECALL_METRIC_NAMES.map((name) => [
				name,
				compareRecallAt(baseline[name], candidate[name]),
			]),
		) as Record<RecallMetricName, Record<RankingCutoffKey, MetricDelta>>,
		singleChunkAnswerQuestionCount: numericDelta(
			baseline.singleChunkAnswerQuestionCount,
			candidate.singleChunkAnswerQuestionCount,
		),
	};
}

function chunkMetrics(
	validation: NoticeChunkValidationReport,
): Record<ChunkMetricName, number> {
	return Object.fromEntries(
		CHUNK_METRIC_NAMES.map((name) => [name, validation[name]]),
	) as Record<ChunkMetricName, number>;
}

function summarizeRankChanges(changes: readonly number[]): RankChangeSummary {
	return {
		improved: changes.filter((change) => change < 0).length,
		regressed: changes.filter((change) => change > 0).length,
		unchanged: changes.filter((change) => change === 0).length,
	};
}

function compareRecallAt(
	baseline: Record<RankingCutoffKey, number> | null,
	candidate: Record<RankingCutoffKey, number> | null,
): Record<RankingCutoffKey, MetricDelta> {
	return {
		"1": metricDelta(baseline?.["1"] ?? null, candidate?.["1"] ?? null),
		"3": metricDelta(baseline?.["3"] ?? null, candidate?.["3"] ?? null),
		"5": metricDelta(baseline?.["5"] ?? null, candidate?.["5"] ?? null),
		"10": metricDelta(baseline?.["10"] ?? null, candidate?.["10"] ?? null),
	};
}

function metricDelta(baseline: number | null, candidate: number | null): MetricDelta {
	return { baseline, candidate, delta: baseline === null || candidate === null ? null : round(candidate - baseline) };
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

export function numericDelta(baseline: number, candidate: number): NumericDelta {
	return { baseline, candidate, delta: round(candidate - baseline) };
}

function round(value: number): number {
	return Number(value.toFixed(6));
}
