import type {
	NoticeEmbeddingEvaluationArtifact,
	NoticeRetrievalQuestion,
} from "../embedding-evaluation/model.ts";
import type { NoticeChunkDefinition } from "../definitions.ts";
import type { DistributionSummary, Sha256Ref } from "../types.ts";
import type { NoticeChunkRunData } from "../run-reader.ts";

export const NOTICE_CHUNK_COMPARISON_SCHEMA_VERSION =
	"notice_chunk_comparison.v1" as const;

export const CHUNK_METRIC_NAMES = [
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

export const MEAN_METRIC_NAMES = [
	"meanAnswerReciprocalRank",
	"meanNoticeReciprocalRank",
	"meanSingleChunkAnswerReciprocalRank",
] as const;

export const RECALL_METRIC_NAMES = [
	"answerEvidenceRecallAt",
	"noticeRecallAt",
	"singleChunkAnswerRecallAt",
] as const;

export type ChunkMetricName = (typeof CHUNK_METRIC_NAMES)[number];
export type MeanMetricName = (typeof MEAN_METRIC_NAMES)[number];
export type RecallMetricName = (typeof RECALL_METRIC_NAMES)[number];
export type RankingCutoffKey = "1" | "3" | "5" | "10";

export interface NumericDelta {
	baseline: number;
	candidate: number;
	delta: number;
}

export interface MetricDelta {
	baseline: number | null;
	candidate: number | null;
	delta: number | null;
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
	mean: Record<MeanMetricName, MetricDelta>;
	questionCount: NumericDelta;
	recallAt: Record<RecallMetricName, Record<RankingCutoffKey, MetricDelta>>;
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

export interface NoticeChunkComparisonInput {
	baseline: NoticeChunkRunData;
	baselineChunkRun: Sha256Ref;
	baselineEvaluation: NoticeEmbeddingEvaluationArtifact;
	candidate: NoticeChunkRunData;
	candidateChunkRun: Sha256Ref;
	candidateEvaluation: NoticeEmbeddingEvaluationArtifact;
	questionFileSha256: Sha256Ref;
	questions: readonly NoticeRetrievalQuestion[];
}
