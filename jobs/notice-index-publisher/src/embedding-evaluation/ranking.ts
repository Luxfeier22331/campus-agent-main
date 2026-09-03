import {
	NOTICE_EMBEDDING_EVALUATION_DEFINITION,
	type NoticeEmbeddingEvaluationMetrics,
	type NoticeQuestionRanking,
	type NoticeRetrievalQuestion,
	type RankingCutoff,
	type RankingCutoffKey,
	type RetrievalMetricSlice,
} from "./model.ts";
import type { NoticeChunk, Sha256Ref } from "../types.ts";

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
	const index = scored.findIndex(
		(item) =>
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

function round(value: number, digits: number): number {
	return Number(value.toFixed(digits));
}
