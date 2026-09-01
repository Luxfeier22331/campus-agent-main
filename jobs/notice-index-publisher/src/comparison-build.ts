import { isDeepStrictEqual } from "node:util";

import {
	compareChunkRuns,
	compareMetricSlice,
	compareMetricStrata,
	summarizeChunkRun,
	summarizeQuestionComparisons,
} from "./comparison-metrics.ts";
import type {
	NoticeChunkComparisonInput,
	NoticeChunkComparisonReport,
} from "./comparison-model.ts";
import { NOTICE_CHUNK_COMPARISON_SCHEMA_VERSION } from "./comparison-model.ts";
import { compareQuestion } from "./comparison-placement.ts";

export function buildNoticeChunkComparison(
	input: NoticeChunkComparisonInput,
): NoticeChunkComparisonReport {
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

function assertComparableInputs(input: NoticeChunkComparisonInput): void {
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
