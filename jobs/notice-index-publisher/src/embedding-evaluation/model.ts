import type { ArtifactReference, Sha256Ref } from "../types.ts";
import {
	CANONICAL_EMBEDDING_MODEL,
	EMBEDDING_SPACE,
} from "@campus-agent/embedding-runtime";

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

export const NOTICE_EMBEDDING_EVALUATION_SCHEMA_VERSION =
	"notice_embedding_evaluation_run.v1" as const;

export type RankingCutoff =
	(typeof NOTICE_EMBEDDING_EVALUATION_DEFINITION.rankingCutoffs)[number];
export type RankingCutoffKey = `${RankingCutoff}`;

export interface NoticeQuestionEvidence {
	chunkId?: string;
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
	chunkId: string;
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
	evidenceChunkIds: string[];
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
	meanSingleChunkAnswerReciprocalRank: number | null;
	noticeRecallAt: Record<RankingCutoffKey, number>;
	questionCount: number;
	singleChunkAnswerQuestionCount: number;
	singleChunkAnswerRecallAt: Record<RankingCutoffKey, number> | null;
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
	embeddingSet?: Sha256Ref;
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
	schemaVersion: typeof NOTICE_EMBEDDING_EVALUATION_SCHEMA_VERSION;
}

export interface NoticeEmbeddingEvaluationArtifact {
	evaluationRun: Sha256Ref;
	manifest: EmbeddingEvaluationManifest;
	metrics: NoticeEmbeddingEvaluationMetrics;
	questions: NoticeRetrievalQuestion[];
	rankings: NoticeQuestionRanking[];
}

export interface NoticeEmbeddingInputSet {
	documentTextByChunkId: Map<string, Sha256Ref>;
	queryTextByQuestionId: Map<string, Sha256Ref>;
	textBySha256: Map<Sha256Ref, string>;
}
